import { z } from "zod";

// --- Parsed lab result from PDF ---

export interface ParsedLabResult {
  testName: string;
  value: number | string;
  unit: string;
  referenceRange: string;
  flag: "normal" | "high" | "low" | "critical_high" | "critical_low";
  category: string;
}

export interface LabReportData {
  id: string;
  userId: string;
  fileName: string;
  reportDate: string | null;
  labName: string | null;
  parsedResults: ParsedLabResult[];
  rawText: string;
  createdAt: string;
}

// --- Health conditions ---

export type ConditionSeverity = "mild" | "moderate" | "severe";

export interface HealthConditionData {
  id: string;
  userId: string;
  name: string;
  severity: ConditionSeverity;
  diagnosedDate: string | null;
  notes: string | null;
  createdAt: string;
}

// --- Medications ---

export type MealTime = "morning" | "afternoon" | "evening" | "night" | "with_breakfast" | "with_lunch" | "with_dinner" | "before_bed" | "as_needed";

export interface MedicationData {
  id: string;
  userId: string;
  name: string;
  dosage: string;
  frequency: string;
  timesOfDay: MealTime[];
  purpose: string | null;
  notes: string | null;
  createdAt: string;
}

// --- Diet entries ---

export type MealType = "breakfast" | "lunch" | "dinner" | "snack" | "beverage";

export interface DietEntryData {
  id: string;
  userId: string;
  mealType: MealType;
  foods: string[];
  typicalTime: string | null;
  notes: string | null;
  createdAt: string;
}

// --- AI Recommendations ---

export interface MedicationScheduleItem {
  time: string;
  medication: string;
  dosage: string;
  withFood: boolean;
  notes: string;
}

export interface MealPlanItem {
  meal: string;
  time: string;
  foods: string[];
  reasoning: string;
}

export interface FoodAdjustment {
  food: string;
  action: "add" | "increase" | "reduce" | "avoid";
  reason: string;
  alternatives?: string[];
}

export interface ExerciseItem {
  name: string;
  duration: string;
  type: "warm_up" | "cardio" | "strength" | "flexibility" | "cool_down";
  instructions: string;
  sets?: number;
  reps?: string;
}

export interface ExerciseRoutine {
  totalDuration: string;
  difficulty: "beginner" | "intermediate" | "advanced";
  exercises: ExerciseItem[];
  weeklySchedule: string[];
  notes: string;
}

export interface HealthInsight {
  area: string;
  priority: "high" | "medium" | "low";
  currentStatus: string;
  recommendation: string;
  timeframe: string;
}

export interface HealthRecommendationData {
  id: string;
  userId: string;
  generatedAt: string;
  medicationSchedule: MedicationScheduleItem[];
  mealPlan: MealPlanItem[];
  foodAdjustments: FoodAdjustment[];
  exerciseRoutine: ExerciseRoutine;
  insights: HealthInsight[];
  summary: string;
}

// --- Zod validation schemas for API inputs ---

export const createConditionSchema = z.object({
  name: z.string().min(1, "Condition name is required").max(200),
  severity: z.enum(["mild", "moderate", "severe"]),
  diagnosedDate: z.string().nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
});

export const updateConditionSchema = createConditionSchema.partial();

export const createMedicationSchema = z.object({
  name: z.string().min(1, "Medication name is required").max(200),
  dosage: z.string().min(1, "Dosage is required").max(100),
  frequency: z.string().min(1, "Frequency is required").max(100),
  timesOfDay: z.array(z.enum(["morning", "afternoon", "evening", "night", "with_breakfast", "with_lunch", "with_dinner", "before_bed", "as_needed"])).min(1),
  purpose: z.string().max(500).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
});

export const updateMedicationSchema = createMedicationSchema.partial();

export const createDietEntrySchema = z.object({
  mealType: z.enum(["breakfast", "lunch", "dinner", "snack", "beverage"]),
  foods: z.array(z.string().min(1)).min(1, "At least one food item is required"),
  typicalTime: z.string().max(20).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
});

export const updateDietEntrySchema = createDietEntrySchema.partial();

export const CONDITION_PRESETS = [
  "Type 2 Diabetes",
  "Type 1 Diabetes",
  "Hypertension",
  "High Cholesterol",
  "Hypothyroidism",
  "Hyperthyroidism",
  "Anemia",
  "Vitamin D Deficiency",
  "GERD / Acid Reflux",
  "Asthma",
  "Arthritis",
  "Obesity",
  "PCOS",
  "Fatty Liver",
  "Kidney Disease",
  "Heart Disease",
  "Depression",
  "Anxiety",
  "Sleep Apnea",
  "Migraine",
] as const;

export const MEAL_TIME_LABELS: Record<MealTime, string> = {
  morning: "Morning",
  afternoon: "Afternoon",
  evening: "Evening",
  night: "Night",
  with_breakfast: "With Breakfast",
  with_lunch: "With Lunch",
  with_dinner: "With Dinner",
  before_bed: "Before Bed",
  as_needed: "As Needed",
};

export const MEAL_TYPE_LABELS: Record<MealType, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snacks",
  beverage: "Beverages",
};
