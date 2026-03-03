import { Clock, Pill, UtensilsCrossed, Dumbbell } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { MedicationScheduleItem, MealPlanItem } from "@shared/healthSchema";

interface DailyRoutineProps {
  medicationSchedule: MedicationScheduleItem[];
  mealPlan: MealPlanItem[];
}

interface TimelineItem {
  time: string;
  type: "medication" | "meal" | "exercise";
  title: string;
  details: string[];
  notes?: string;
  sortKey: number;
}

function parseTime(timeStr: string): number {
  const match = timeStr.match(/(\d{1,2}):?(\d{2})?\s*(AM|PM)?/i);
  if (!match) return 0;
  let hours = parseInt(match[1]);
  const minutes = parseInt(match[2] || "0");
  const period = match[3]?.toUpperCase();
  if (period === "PM" && hours !== 12) hours += 12;
  if (period === "AM" && hours === 12) hours = 0;
  return hours * 60 + minutes;
}

const TYPE_STYLES = {
  medication: { icon: Pill, color: "border-l-blue-500 bg-blue-50/50 dark:bg-blue-950/20" },
  meal: { icon: UtensilsCrossed, color: "border-l-green-500 bg-green-50/50 dark:bg-green-950/20" },
  exercise: { icon: Dumbbell, color: "border-l-purple-500 bg-purple-50/50 dark:bg-purple-950/20" },
};

export function DailyRoutine({ medicationSchedule, mealPlan }: DailyRoutineProps) {
  const items: TimelineItem[] = [];

  (medicationSchedule || []).forEach(med => {
    items.push({
      time: med.time,
      type: "medication",
      title: med.medication,
      details: [
        med.dosage,
        med.withFood ? "Take with food" : "Can take on empty stomach",
      ].filter(Boolean),
      notes: med.notes,
      sortKey: parseTime(med.time),
    });
  });

  (mealPlan || []).forEach(meal => {
    items.push({
      time: meal.time,
      type: "meal",
      title: meal.meal,
      details: meal.foods || [],
      notes: meal.reasoning,
      sortKey: parseTime(meal.time),
    });
  });

  items.sort((a, b) => a.sortKey - b.sortKey);

  if (!items.length) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Clock className="h-12 w-12 text-muted-foreground/50" />
        <p className="mt-3 text-sm text-muted-foreground">No daily routine generated yet</p>
        <p className="text-xs text-muted-foreground">Generate your health plan to see a personalized schedule</p>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Clock className="h-4 w-4" />
          Daily Schedule
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {items.map((item, i) => {
            const style = TYPE_STYLES[item.type];
            const Icon = style.icon;
            return (
              <div key={i} className={`rounded-lg border-l-4 px-4 py-3 ${style.color}`}>
                <div className="flex items-start gap-3">
                  <div className="flex flex-col items-center pt-0.5">
                    <span className="text-sm font-semibold tabular-nums">{item.time}</span>
                    <Icon className="mt-1 h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{item.title}</p>
                    <div className="mt-0.5 text-sm text-muted-foreground">
                      {item.details.map((d, j) => (
                        <span key={j}>
                          {j > 0 && " · "}
                          {d}
                        </span>
                      ))}
                    </div>
                    {item.notes && (
                      <p className="mt-1 text-xs text-muted-foreground italic">{item.notes}</p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
