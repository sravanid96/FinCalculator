import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { HeartPulse, FileText, User, UtensilsCrossed, CalendarClock, Sparkles, Loader2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { LabReportUpload } from "@/components/health/LabReportUpload";
import { LabResultsDisplay } from "@/components/health/LabResultsDisplay";
import { HealthConditionsForm } from "@/components/health/HealthConditionsForm";
import { MedicationTracker } from "@/components/health/MedicationTracker";
import { DietProfile } from "@/components/health/DietProfile";
import { DailyRoutine } from "@/components/health/DailyRoutine";
import { FoodRecommendations } from "@/components/health/FoodRecommendations";
import { ExerciseRoutineDisplay } from "@/components/health/ExerciseRoutine";
import { HealthInsights } from "@/components/health/HealthInsights";
import type {
  MedicationScheduleItem,
  MealPlanItem,
  FoodAdjustment,
  ExerciseRoutine,
  HealthInsight,
} from "@shared/healthSchema";

interface Recommendation {
  id: string;
  generatedAt: string;
  medicationSchedule: MedicationScheduleItem[];
  mealPlan: MealPlanItem[];
  foodAdjustments: FoodAdjustment[];
  exerciseRoutine: ExerciseRoutine;
  insights: HealthInsight[];
  summary: string;
}

export default function Health() {
  const [activeTab, setActiveTab] = useState("lab-reports");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: recommendation, isLoading: recLoading } = useQuery<Recommendation | null>({
    queryKey: ["/api/health/recommendations"],
  });

  const { data: labReports } = useQuery<any[]>({
    queryKey: ["/api/health/lab-reports"],
  });

  const { data: conditions } = useQuery<any[]>({
    queryKey: ["/api/health/conditions"],
  });

  const { data: medications } = useQuery<any[]>({
    queryKey: ["/api/health/medications"],
  });

  useQuery<any[]>({
    queryKey: ["/api/health/diet"],
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      const token = localStorage.getItem("auth_token");
      let res: Response;
      try {
        res = await fetch("/api/health/recommendations/generate", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          credentials: "include",
        });
      } catch (e) {
        throw new Error(
          "Could not reach the server. Make sure the app server is running and try again."
        );
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to generate plan");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/health/recommendations"] });
      toast({ title: "Health plan generated", description: "Your personalized daily plan is ready!" });
      setActiveTab("daily-plan");
    },
    onError: (error: Error) => {
      toast({ title: "Generation failed", description: error.message, variant: "destructive" });
    },
  });

  const hasData = (labReports?.length || 0) > 0 || (conditions?.length || 0) > 0 || (medications?.length || 0) > 0;

  return (
    <div className="flex h-full flex-col overflow-auto">
      <div className="border-b bg-background px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold">
              <HeartPulse className="h-6 w-6 text-red-500" />
              Health
            </h1>
            <p className="text-sm text-muted-foreground">
              Upload lab reports, track conditions & medications, and get a personalized health plan
            </p>
          </div>
          <Button
            onClick={() => generateMutation.mutate()}
            disabled={generateMutation.isPending || !hasData}
            size="lg"
          >
            {generateMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-4 w-4" />
                Generate My Plan
              </>
            )}
          </Button>
        </div>

        {generateMutation.isPending && (
          <Card className="mt-3 border-primary/20 bg-primary/5">
            <CardContent className="flex items-center gap-3 py-3">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <div>
                <p className="text-sm font-medium">AI is analyzing your health data...</p>
                <p className="text-xs text-muted-foreground">This may take 15-30 seconds. Generating medication schedule, meal plans, exercise routine, and insights.</p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <div className="flex-1 overflow-auto px-6 py-4">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-4">
            <TabsTrigger value="lab-reports" className="gap-1.5">
              <FileText className="h-4 w-4" />
              Lab Reports
            </TabsTrigger>
            <TabsTrigger value="profile" className="gap-1.5">
              <User className="h-4 w-4" />
              Health Profile
            </TabsTrigger>
            <TabsTrigger value="diet" className="gap-1.5">
              <UtensilsCrossed className="h-4 w-4" />
              My Diet
            </TabsTrigger>
            <TabsTrigger value="daily-plan" className="gap-1.5">
              <CalendarClock className="h-4 w-4" />
              Daily Plan
              {recommendation && (
                <span className="ml-1 h-2 w-2 rounded-full bg-green-500" />
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="lab-reports" className="space-y-4">
            <LabReportUpload />
            <LabResultsDisplay />
          </TabsContent>

          <TabsContent value="profile" className="space-y-4">
            <HealthConditionsForm />
            <MedicationTracker />
          </TabsContent>

          <TabsContent value="diet">
            <DietProfile />
          </TabsContent>

          <TabsContent value="daily-plan" className="space-y-4">
            {recLoading && (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            )}
            {!recLoading && recommendation && (
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-4">
                  <DailyRoutine
                    medicationSchedule={recommendation.medicationSchedule}
                    mealPlan={recommendation.mealPlan}
                  />
                  <FoodRecommendations adjustments={recommendation.foodAdjustments} />
                </div>
                <div className="space-y-4">
                  <HealthInsights insights={recommendation.insights} summary={recommendation.summary} />
                  <ExerciseRoutineDisplay routine={recommendation.exerciseRoutine} />
                </div>
              </div>
            )}
            {!recLoading && !recommendation && (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <Sparkles className="h-16 w-16 text-muted-foreground/30" />
                <h3 className="mt-4 text-lg font-medium">No health plan yet</h3>
                <p className="mt-1 max-w-md text-sm text-muted-foreground">
                  {hasData
                    ? 'Click "Generate My Plan" to get personalized medication schedules, meal plans, exercise routines, and health insights based on your data.'
                    : "Start by uploading a lab report, adding your health conditions, medications, or diet information. Then generate your personalized health plan."
                  }
                </p>
                {!hasData && (
                  <Button variant="outline" className="mt-4" onClick={() => setActiveTab("lab-reports")}>
                    <FileText className="mr-2 h-4 w-4" />
                    Upload Lab Report
                  </Button>
                )}
              </div>
            )}

            {recommendation && (
              <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-4 py-2 text-sm text-muted-foreground">
                <span>
                  Generated on {new Date(recommendation.generatedAt).toLocaleDateString()} at{" "}
                  {new Date(recommendation.generatedAt).toLocaleTimeString()}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => generateMutation.mutate()}
                  disabled={generateMutation.isPending}
                >
                  Regenerate
                </Button>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
