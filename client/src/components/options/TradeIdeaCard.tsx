import {
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CheckCircle,
  Calendar,
  Target,
  DollarSign,
  Percent,
  Clock,
  ListPlus,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { TradeIdea } from "@shared/optionsSchema";

interface TradeIdeaCardProps {
  idea: TradeIdea;
  selected?: boolean;
  onClick?: () => void;
  onAddToWatchlist?: () => void;
  watchlistBusy?: boolean;
}

const recommendationConfig = {
  strong_buy: {
    label: "Strong Buy",
    color: "bg-green-500 text-white",
    icon: CheckCircle,
  },
  buy: {
    label: "Buy",
    color: "bg-green-400 text-white",
    icon: TrendingUp,
  },
  neutral: {
    label: "Neutral",
    color: "bg-yellow-500 text-white",
    icon: Target,
  },
  avoid: {
    label: "Avoid",
    color: "bg-red-500 text-white",
    icon: AlertTriangle,
  },
};

export function TradeIdeaCard({
  idea,
  selected,
  onClick,
  onAddToWatchlist,
  watchlistBusy,
}: TradeIdeaCardProps) {
  const rec = recommendationConfig[idea.recommendation];
  const RecIcon = rec.icon;

  return (
    <Card
      className={cn(
        "cursor-pointer transition-all hover:shadow-md",
        selected && "ring-2 ring-primary shadow-md"
      )}
      onClick={onClick}
    >
      <CardContent className="p-4">
        {/* Header */}
        <div className="flex items-start justify-between mb-3">
          <div>
            <h4 className="font-semibold">{idea.strategyName}</h4>
            <p className="text-sm text-muted-foreground">
              {idea.daysToExpiration} DTE | Exp: {idea.expirationDate}
            </p>
          </div>
          <Badge className={cn("flex items-center gap-1", rec.color)}>
            <RecIcon className="h-3 w-3" />
            {rec.label}
          </Badge>
        </div>

        {/* Trade Legs */}
        <div className="mb-3 space-y-1 text-sm">
          {idea.legs.map((leg, index) => (
            <div key={index} className="flex items-center justify-between text-muted-foreground">
              <span>
                {leg.action === "sell" ? "Sell" : "Buy"} ${leg.strike} {leg.type}
              </span>
              <span className={leg.action === "sell" ? "text-green-600" : "text-red-600"}>
                {leg.action === "sell" ? "+" : "-"}${leg.price.toFixed(2)}
              </span>
            </div>
          ))}
        </div>

        {/* Metrics Grid */}
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="flex items-center gap-1">
            <DollarSign className="h-3 w-3 text-green-500" />
            <span className="text-muted-foreground">Max Profit:</span>
            <span className="font-medium text-green-600">${idea.maxProfit.toFixed(0)}</span>
          </div>
          <div className="flex items-center gap-1">
            <TrendingDown className="h-3 w-3 text-red-500" />
            <span className="text-muted-foreground">Max Loss:</span>
            <span className="font-medium text-red-600">${Math.abs(idea.maxLoss).toFixed(0)}</span>
          </div>
          <div className="flex items-center gap-1">
            <Percent className="h-3 w-3 text-blue-500" />
            <span className="text-muted-foreground">POP:</span>
            <span className="font-medium">{idea.probabilityOfProfit}%</span>
          </div>
          <div className="flex items-center gap-1">
            <Target className="h-3 w-3 text-purple-500" />
            <span className="text-muted-foreground">R:R:</span>
            <span className="font-medium">1:{(1/idea.riskRewardRatio).toFixed(1)}</span>
          </div>
        </div>

        {/* Breakeven */}
        <div className="mt-2 text-sm">
          <span className="text-muted-foreground">Breakeven: </span>
          <span className="font-medium">
            {idea.breakeven.map((b) => `$${b.toFixed(2)}`).join(" / ")}
          </span>
        </div>

        {/* Earnings Warning */}
        {idea.hasEarningsRisk && (
          <div className="mt-3 flex items-center gap-2 rounded-md bg-yellow-500/10 px-2 py-1 text-sm text-yellow-600">
            <AlertTriangle className="h-4 w-4" />
            <span>Earnings on {idea.earningsDate} - elevated risk</span>
          </div>
        )}

        {/* Notes */}
        {idea.notes.length > 0 && (
          <div className="mt-3 space-y-1 border-t pt-2">
            {idea.notes.slice(0, 2).map((note, index) => (
              <p key={index} className="text-xs text-muted-foreground">
                {note}
              </p>
            ))}
          </div>
        )}

        {onAddToWatchlist && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-3 w-full"
            disabled={watchlistBusy}
            onClick={(e) => {
              e.stopPropagation();
              onAddToWatchlist();
            }}
          >
            <ListPlus className="mr-2 h-4 w-4" />
            Add to watchlist
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
