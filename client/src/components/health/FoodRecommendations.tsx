import { ArrowUp, ArrowDown, Ban, Plus, Apple } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { FoodAdjustment } from "@shared/healthSchema";

interface FoodRecommendationsProps {
  adjustments: FoodAdjustment[];
}

const ACTION_CONFIG = {
  add: { label: "Add to Diet", icon: Plus, color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" },
  increase: { label: "Eat More", icon: ArrowUp, color: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400" },
  reduce: { label: "Reduce", icon: ArrowDown, color: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400" },
  avoid: { label: "Avoid", icon: Ban, color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400" },
};

export function FoodRecommendations({ adjustments }: FoodRecommendationsProps) {
  if (!adjustments?.length) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Apple className="h-12 w-12 text-muted-foreground/50" />
        <p className="mt-3 text-sm text-muted-foreground">No food recommendations yet</p>
      </div>
    );
  }

  const grouped = {
    add: adjustments.filter(a => a.action === "add"),
    increase: adjustments.filter(a => a.action === "increase"),
    reduce: adjustments.filter(a => a.action === "reduce"),
    avoid: adjustments.filter(a => a.action === "avoid"),
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Apple className="h-4 w-4" />
          Food Adjustments
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {(Object.entries(grouped) as [keyof typeof ACTION_CONFIG, FoodAdjustment[]][]).map(([action, items]) => {
          if (!items.length) return null;
          const config = ACTION_CONFIG[action];
          const Icon = config.icon;
          return (
            <div key={action}>
              <div className="mb-2 flex items-center gap-2">
                <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${config.color}`}>
                  <Icon className="h-3 w-3" />
                  {config.label}
                </span>
              </div>
              <div className="space-y-2">
                {items.map((item, i) => (
                  <div key={i} className="rounded-lg border px-3 py-2.5">
                    <div className="flex items-start justify-between">
                      <span className="font-medium">{item.food}</span>
                    </div>
                    <p className="mt-0.5 text-sm text-muted-foreground">{item.reason}</p>
                    {item.alternatives && item.alternatives.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        <span className="text-xs text-muted-foreground">Try instead:</span>
                        {item.alternatives.map((alt, j) => (
                          <Badge key={j} variant="outline" className="text-xs">{alt}</Badge>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
