import { Dumbbell, Timer, Calendar } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { ExerciseRoutine as ExerciseRoutineType, ExerciseItem } from "@shared/healthSchema";

interface ExerciseRoutineProps {
  routine: ExerciseRoutineType | null;
}

const TYPE_COLORS: Record<ExerciseItem["type"], string> = {
  warm_up: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  cardio: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  strength: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  flexibility: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  cool_down: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
};

const TYPE_LABELS: Record<ExerciseItem["type"], string> = {
  warm_up: "Warm Up",
  cardio: "Cardio",
  strength: "Strength",
  flexibility: "Flexibility",
  cool_down: "Cool Down",
};

export function ExerciseRoutineDisplay({ routine }: ExerciseRoutineProps) {
  if (!routine || !routine.exercises?.length) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Dumbbell className="h-12 w-12 text-muted-foreground/50" />
        <p className="mt-3 text-sm text-muted-foreground">No exercise routine yet</p>
        <p className="text-xs text-muted-foreground">Generate your health plan to get a personalized workout</p>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Dumbbell className="h-4 w-4" />
          Exercise Routine
        </CardTitle>
        <CardDescription className="flex items-center gap-4">
          <span className="flex items-center gap-1">
            <Timer className="h-3.5 w-3.5" />{routine.totalDuration}
          </span>
          <Badge variant="outline" className="capitalize">{routine.difficulty}</Badge>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          {routine.exercises.map((exercise, i) => (
            <div key={i} className="rounded-lg border px-4 py-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{exercise.name}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${TYPE_COLORS[exercise.type]}`}>
                      {TYPE_LABELS[exercise.type]}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{exercise.instructions}</p>
                </div>
                <div className="shrink-0 text-right text-sm">
                  <span className="font-medium">{exercise.duration}</span>
                  {exercise.sets && exercise.reps && (
                    <p className="text-xs text-muted-foreground">{exercise.sets}x{exercise.reps}</p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {routine.weeklySchedule?.length > 0 && (
          <div>
            <h4 className="mb-2 flex items-center gap-1.5 text-sm font-medium">
              <Calendar className="h-3.5 w-3.5" />
              Weekly Schedule
            </h4>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {routine.weeklySchedule.map((day, i) => (
                <div key={i} className="rounded-md border px-3 py-1.5 text-sm">
                  {day}
                </div>
              ))}
            </div>
          </div>
        )}

        {routine.notes && (
          <p className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground italic">
            {routine.notes}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
