import { Lightbulb, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { HealthInsight } from "@shared/healthSchema";

interface HealthInsightsProps {
  insights: HealthInsight[];
  summary: string;
}

const PRIORITY_STYLES = {
  high: "border-l-red-500 bg-red-50/50 dark:bg-red-950/20",
  medium: "border-l-amber-500 bg-amber-50/50 dark:bg-amber-950/20",
  low: "border-l-green-500 bg-green-50/50 dark:bg-green-950/20",
};

const PRIORITY_BADGE = {
  high: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  medium: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  low: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
};

export function HealthInsights({ insights, summary }: HealthInsightsProps) {
  if (!insights?.length && !summary) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Lightbulb className="h-12 w-12 text-muted-foreground/50" />
        <p className="mt-3 text-sm text-muted-foreground">No health insights yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {summary && (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm leading-relaxed">{summary}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Lightbulb className="h-4 w-4" />
            Priority Areas
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {(insights || []).map((insight, i) => (
            <div key={i} className={`rounded-lg border-l-4 px-4 py-3 ${PRIORITY_STYLES[insight.priority]}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{insight.area}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${PRIORITY_BADGE[insight.priority]}`}>
                      {insight.priority}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{insight.currentStatus}</p>
                  <div className="mt-2 flex items-start gap-1.5 text-sm">
                    <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                    <span>{insight.recommendation}</span>
                  </div>
                  {insight.timeframe && (
                    <p className="mt-1 text-xs text-muted-foreground italic">
                      Expected improvement: {insight.timeframe}
                    </p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
