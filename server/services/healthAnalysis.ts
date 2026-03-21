import type {
  ParsedLabResult,
  HealthConditionData,
  MedicationData,
  DietEntryData,
  MedicationScheduleItem,
  MealPlanItem,
  FoodAdjustment,
  ExerciseRoutine,
  HealthInsight,
} from "@shared/healthSchema";

// Local-only health plan generation using a local LLM via Ollama (e.g. mistral:instruct).
// No external API keys are required; everything stays on the machine where the server runs.

async function callLocalMistral(prompt: string): Promise<string> {
  const model = process.env.HEALTH_LLM_MODEL || "mistral:instruct";
  let res: Response;
  try {
    res = await fetch("http://localhost:11434/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
      }),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/ECONNREFUSED|fetch failed|network|ENOTFOUND/i.test(msg)) {
      throw new Error(
        "Ollama is not reachable. Start the Ollama app (or run 'ollama serve' on the same machine as this server), then try again."
      );
    }
    throw err;
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const suffix = text ? ": " + text : "";
    throw new Error("Local LLM error (" + res.status + " " + res.statusText + ")" + suffix);
  }

  const data = (await res.json()) as { response?: string; error?: string };
  if (!data.response) {
    throw new Error(data.error || "No response from local LLM");
  }
  return data.response;
}

interface HealthPlanInput {
  labResults: ParsedLabResult[];
  conditions: HealthConditionData[];
  medications: MedicationData[];
  dietEntries: DietEntryData[];
}

interface HealthPlanOutput {
  medicationSchedule: MedicationScheduleItem[];
  mealPlan: MealPlanItem[];
  foodAdjustments: FoodAdjustment[];
  exerciseRoutine: ExerciseRoutine;
  insights: HealthInsight[];
  summary: string;
}

export async function generateHealthPlan(input: HealthPlanInput): Promise<HealthPlanOutput> {
  const labLines = input.labResults.map(r => {
    return `- ${r.testName}: ${r.value} ${r.unit} (ref: ${r.referenceRange}) [${r.flag.toUpperCase()}] (${r.category})`;
  });
  const labSection = labLines.length > 0
    ? `LAB RESULTS:\n${labLines.join("\n")}`
    : "LAB RESULTS: None provided";

  const condLines = input.conditions.map(c => {
    const diagnosed = c.diagnosedDate ? `, diagnosed: ${c.diagnosedDate}` : "";
    const notes = c.notes ? `, notes: ${c.notes}` : "";
    return `- ${c.name} (severity: ${c.severity}${diagnosed}${notes})`;
  });
  const conditionSection = condLines.length > 0
    ? `EXISTING HEALTH CONDITIONS:\n${condLines.join("\n")}`
    : "EXISTING HEALTH CONDITIONS: None reported";

  const medLines = input.medications.map(m => {
    const purpose = m.purpose ? ` (for: ${m.purpose})` : "";
    const notes = m.notes ? ` - ${m.notes}` : "";
    return `- ${m.name} ${m.dosage}, ${m.frequency}, taken: ${m.timesOfDay.join(", ")}${purpose}${notes}`;
  });
  const medSection = medLines.length > 0
    ? `CURRENT MEDICATIONS:\n${medLines.join("\n")}`
    : "CURRENT MEDICATIONS: None";

  const dietLines = input.dietEntries.map(d => {
    const time = d.typicalTime ? ` (${d.typicalTime})` : "";
    const notes = d.notes ? ` - ${d.notes}` : "";
    return `- ${d.mealType}${time}: ${d.foods.join(", ")}${notes}`;
  });
  const dietSection = dietLines.length > 0
    ? `CURRENT DIET:\n${dietLines.join("\n")}`
    : "CURRENT DIET: Not provided";

  const prompt = `You are an expert health and wellness advisor. Based on the following patient data, create a comprehensive personalized daily health plan.

${labSection}

${conditionSection}

${medSection}

${dietSection}

Generate a COMPLETE daily health plan with the following sections. Be specific with times, exact foods, portions, and exercises. Tailor everything to the lab results and conditions.

Return ONLY valid JSON in this exact structure:
{
  "medicationSchedule": [
    {
      "time": "7:00 AM",
      "medication": "medication name",
      "dosage": "dosage info",
      "withFood": true/false,
      "notes": "any important notes about taking this medication"
    }
  ],
  "mealPlan": [
    {
      "meal": "Breakfast/Lunch/Dinner/Morning Snack/Evening Snack",
      "time": "8:00 AM",
      "foods": ["specific food with portion", "another food"],
      "reasoning": "why these foods based on lab results and conditions"
    }
  ],
  "foodAdjustments": [
    {
      "food": "specific food",
      "action": "add|increase|reduce|avoid",
      "reason": "based on which lab result or condition",
      "alternatives": ["alternative food options"]
    }
  ],
  "exerciseRoutine": {
    "totalDuration": "35 minutes",
    "difficulty": "beginner|intermediate|advanced",
    "exercises": [
      {
        "name": "exercise name",
        "duration": "5 minutes",
        "type": "warm_up|cardio|strength|flexibility|cool_down",
        "instructions": "step by step instructions",
        "sets": 3,
        "reps": "12"
      }
    ],
    "weeklySchedule": ["Monday: Full body", "Tuesday: Cardio", ...],
    "notes": "general exercise advice based on conditions"
  },
  "insights": [
    {
      "area": "area of focus (e.g., Blood Sugar Management, Heart Health)",
      "priority": "high|medium|low",
      "currentStatus": "assessment based on lab results",
      "recommendation": "specific actionable recommendation",
      "timeframe": "expected timeframe for improvement"
    }
  ],
  "summary": "A 2-3 sentence overall health summary and top priorities"
}

Important guidelines:
- Schedule medications at optimal times considering food interactions and other medications
- If the user is already eating certain foods, suggest adjustments rather than a completely new diet
- Focus on foods that specifically address abnormal lab values
- Exercise routine should be 30-45 minutes, safe for the reported conditions
- Prioritize insights by what needs the most urgent attention based on lab flags
- Be practical and realistic - suggest commonly available foods
- Consider medication-food interactions (e.g., thyroid meds on empty stomach, statins at night)`;

  const text = await callLocalMistral(prompt);
  const jsonMatch = /\{[\s\S]*\}/.exec(text);
  if (!jsonMatch) {
    throw new Error("Failed to parse health plan from AI response");
  }

  const parsed = JSON.parse(jsonMatch[0]);

  return {
    medicationSchedule: parsed.medicationSchedule || [],
    mealPlan: parsed.mealPlan || [],
    foodAdjustments: parsed.foodAdjustments || [],
    exerciseRoutine: parsed.exerciseRoutine || {
      totalDuration: "35 minutes",
      difficulty: "beginner",
      exercises: [],
      weeklySchedule: [],
      notes: "",
    },
    insights: parsed.insights || [],
    summary: parsed.summary || "",
  };
}
