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
  Activity,
  ArrowUp,
  ArrowDown,
  Brain,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { LearnedSignal, TradeIdea } from "@shared/optionsSchema";

interface TradeIdeaCardProps {
  idea: TradeIdea;
  selected?: boolean;
  onClick?: () => void;
  onAddToWatchlist?: () => void;
  watchlistBusy?: boolean;
  /** Adjustment derived from the user's own settled outcomes (self-improving). */
  learnedSignal?: LearnedSignal;
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
  learnedSignal,
}: TradeIdeaCardProps) {
  const rec = recommendationConfig[idea.recommendation];
  const RecIcon = rec.icon;
  const showLearned =
    learnedSignal &&
    (learnedSignal.direction !== "neutral" || learnedSignal.matched.length > 0);

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

        {/* RSI Zone Analysis */}
        {idea.rsiAnalysis && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  className={cn(
                    "mt-3 flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-help",
                    idea.rsiAnalysis.zone === "oversold" && "bg-green-500/10 text-green-600 border border-green-200",
                    idea.rsiAnalysis.zone === "overbought" && "bg-red-500/10 text-red-600 border border-red-200",
                    idea.rsiAnalysis.zone === "neutral" && "bg-blue-500/10 text-blue-600 border border-blue-200"
                  )}
                >
                  <Activity className="h-4 w-4" />
                  <span className="font-medium">RSI {idea.rsiAnalysis.value.toFixed(1)}</span>
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-xs",
                      idea.rsiAnalysis.zone === "oversold" && "border-green-500 text-green-600",
                      idea.rsiAnalysis.zone === "overbought" && "border-red-500 text-red-600",
                      idea.rsiAnalysis.zone === "neutral" && "border-blue-500 text-blue-600"
                    )}
                  >
                    {idea.rsiAnalysis.zone === "oversold" && (
                      <>
                        <ArrowDown className="mr-1 h-3 w-3" />
                        Oversold
                      </>
                    )}
                    {idea.rsiAnalysis.zone === "overbought" && (
                      <>
                        <ArrowUp className="mr-1 h-3 w-3" />
                        Overbought
                      </>
                    )}
                    {idea.rsiAnalysis.zone === "neutral" && "Neutral"}
                  </Badge>
                  {idea.rsiAnalysis.confidenceBoost !== 0 && (
                    <span
                      className={cn(
                        "text-xs font-semibold",
                        idea.rsiAnalysis.confidenceBoost > 0 ? "text-green-600" : "text-red-500"
                      )}
                    >
                      {idea.rsiAnalysis.confidenceBoost > 0 ? "+" : ""}
                      {idea.rsiAnalysis.confidenceBoost}% confidence
                    </span>
                  )}
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs">
                <p className="text-sm">{idea.rsiAnalysis.signal}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}

        {/* Earnings Warning */}
        {idea.hasEarningsRisk && (
          <div className="mt-3 flex items-center gap-2 rounded-md bg-yellow-500/10 px-2 py-1 text-sm text-yellow-600">
            <AlertTriangle className="h-4 w-4" />
            <span>Earnings on {idea.earningsDate} - elevated risk</span>
          </div>
        )}

        {/* Self-improving: adjustment from your own settled outcomes */}
        {showLearned && learnedSignal && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  className={cn(
                    "mt-3 flex items-start gap-2 rounded-md border px-2 py-1.5 text-xs cursor-help",
                    learnedSignal.direction === "favor" &&
                      "border-green-200 bg-green-500/10 text-green-700",
                    learnedSignal.direction === "caution" &&
                      "border-red-200 bg-red-500/10 text-red-700",
                    learnedSignal.direction === "neutral" &&
                      "border-blue-200 bg-blue-500/10 text-blue-700",
                  )}
                >
                  <Brain className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <div className="space-y-0.5">
                    <span className="font-medium">
                      Your history:{" "}
                      {learnedSignal.direction === "favor"
                        ? "favored"
                        : learnedSignal.direction === "caution"
                          ? "caution"
                          : "neutral"}
                      {learnedSignal.deltaWinRatePct != null
                        ? ` (${learnedSignal.deltaWinRatePct >= 0 ? "+" : ""}${learnedSignal.deltaWinRatePct}% win)`
                        : ""}
                    </span>
                    {learnedSignal.suggestedRecommendation &&
                      learnedSignal.suggestedRecommendation !== idea.recommendation && (
                        <span className="block">
                          Suggests:{" "}
                          {recommendationConfig[learnedSignal.suggestedRecommendation].label}
                        </span>
                      )}
                  </div>
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs">
                <p className="text-sm">{learnedSignal.note}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
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
