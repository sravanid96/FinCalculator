import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  CheckCircle2,
  XCircle,
  Target,
  TrendingUp,
  Activity,
  Sparkles,
  Shield,
  AlertTriangle,
  Lightbulb,
} from "lucide-react";
import type { TickerAnalysis, TradeIdea, FrameworkCheck } from "@shared/optionsSchema";

interface FrameworkTradeAnalyzerProps {
  analysis: TickerAnalysis;
  selectedTrade: TradeIdea | null;
  onTradeSelect: (trade: TradeIdea) => void;
}

const PILLAR_ICONS = {
  fundamental: Target,
  technical: TrendingUp,
  options: Activity,
  macro: Sparkles,
  risk: Shield,
};

const PILLAR_COLORS = {
  fundamental: "bg-blue-500",
  technical: "bg-purple-500",
  options: "bg-orange-500",
  macro: "bg-green-500",
  risk: "bg-red-500",
};

export function FrameworkTradeAnalyzer({
  analysis,
  selectedTrade,
  onTradeSelect,
}: FrameworkTradeAnalyzerProps) {
  const framework = analysis.frameworkAnalysis;

  if (!framework) {
    return (
      <Card className="border-yellow-200 bg-yellow-50/50">
        <CardContent className="pt-6">
          <div className="flex items-center gap-2 text-yellow-700">
            <AlertTriangle className="h-5 w-5" />
            <span className="text-sm">Framework analysis data not available. Try refreshing.</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  const { checks, scores, suggestions, indicators } = framework;

  const getScoreColor = (pct: number) => {
    if (pct >= 70) return "text-green-600";
    if (pct >= 50) return "text-yellow-600";
    return "text-red-600";
  };

  const getScoreBg = (pct: number) => {
    if (pct >= 70) return "bg-green-500";
    if (pct >= 50) return "bg-yellow-500";
    return "bg-red-500";
  };

  const checkedCount = checks.filter((c) => c.passed).length;
  const totalCount = checks.length;

  // Group checks by pillar
  const checksByPillar = checks.reduce((acc, check) => {
    if (!acc[check.pillar]) acc[check.pillar] = [];
    acc[check.pillar].push(check);
    return acc;
  }, {} as Record<string, FrameworkCheck[]>);

  return (
    <div className="space-y-4">
      {/* Overall Confluence Score */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Target className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg">Framework Analysis</CardTitle>
            </div>
            <Badge
              variant={scores.overall >= 60 ? "default" : "secondary"}
              className={scores.overall >= 70 ? "bg-green-600" : scores.overall >= 50 ? "bg-yellow-600" : ""}
            >
              {checkedCount}/{totalCount} passed
            </Badge>
          </div>
          <CardDescription>
            Auto-calculated from market data (Yahoo Finance). Higher confluence = higher conviction.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Confluence Score Bar */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Confluence Score</span>
              <span className={`text-sm font-bold ${getScoreColor(scores.overall)}`}>
                {scores.overall}% —{" "}
                {scores.overall >= 70
                  ? "Strong Setup"
                  : scores.overall >= 50
                    ? "Moderate"
                    : "Weak Setup"}
              </span>
            </div>
            <Progress value={scores.overall} className="h-2" />
          </div>

          {/* Pillar Scores Grid */}
          <div className="grid grid-cols-5 gap-2">
            {Object.entries(scores)
              .filter(([key]) => key !== "overall")
              .map(([pillar, score]) => {
                const Icon = PILLAR_ICONS[pillar as keyof typeof PILLAR_ICONS] || Target;
                return (
                  <div key={pillar} className="flex flex-col items-center gap-1">
                    <Icon className={`h-4 w-4 ${getScoreColor(score.pct)}`} />
                    <span className="text-[10px] font-medium capitalize text-muted-foreground">
                      {pillar}
                    </span>
                    <span className={`text-xs font-bold ${getScoreColor(score.pct)}`}>
                      {score.pct}%
                    </span>
                  </div>
                );
              })}
          </div>
        </CardContent>
      </Card>

      {/* Technical Indicators Summary */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Technical Snapshot</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded bg-muted p-2">
              <div className="text-xs text-muted-foreground">Trend</div>
              <div
                className={`text-sm font-semibold ${
                  indicators.trend === "bullish"
                    ? "text-green-600"
                    : indicators.trend === "bearish"
                      ? "text-red-600"
                      : "text-yellow-600"
                }`}
              >
                {indicators.trend.charAt(0).toUpperCase() + indicators.trend.slice(1)}
              </div>
            </div>
            <div className="rounded bg-muted p-2">
              <div className="text-xs text-muted-foreground">RSI</div>
              <div className="text-sm font-semibold">
                {indicators.rsi?.toFixed(1) || "N/A"}
                {indicators.rsi && (
                  <span
                    className={`ml-1 text-xs ${
                      indicators.rsi > 70 ? "text-red-500" : indicators.rsi < 30 ? "text-blue-500" : ""
                    }`}
                  >
                    {indicators.rsi > 70 ? "(OB)" : indicators.rsi < 30 ? "(OS)" : ""}
                  </span>
                )}
              </div>
            </div>
            <div className="rounded bg-muted p-2">
              <div className="text-xs text-muted-foreground">IV Rank</div>
              <div className="text-sm font-semibold">
                {indicators.ivRank?.toFixed(0) || "N/A"}%
                {indicators.ivRank && (
                  <span
                    className={`ml-1 text-xs ${
                      indicators.ivRank > 50 ? "text-orange-500" : "text-blue-500"
                    }`}
                  >
                    {indicators.ivRank > 50 ? "(High)" : "(Low)"}
                  </span>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Detailed Checks by Pillar */}
      <Card className="overflow-hidden">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Framework Checks by Pillar</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="h-[280px]">
            <Accordion type="multiple" defaultValue={[]} className="w-full px-4 pb-4">
              {Object.entries(checksByPillar).map(([pillar, pillarChecks]) => {
                const Icon = PILLAR_ICONS[pillar as keyof typeof PILLAR_ICONS] || Target;
                const passedCount = pillarChecks.filter((c) => c.passed).length;
                const score = scores[pillar as keyof typeof scores] as { pct: number } | undefined;

                return (
                  <AccordionItem key={pillar} value={pillar} className="border-b last:border-0">
                    <AccordionTrigger className="py-3 text-sm font-medium hover:no-underline">
                      <span className="flex items-center gap-2">
                        <Icon className="h-4 w-4" />
                        <span className="capitalize">{pillar}</span>
                        <Badge
                          variant="secondary"
                          className={`text-xs ${score && score.pct >= 70 ? "bg-green-100 text-green-700" : score && score.pct >= 50 ? "bg-yellow-100 text-yellow-700" : "bg-red-100 text-red-700"}`}
                        >
                          {passedCount}/{pillarChecks.length}
                        </Badge>
                      </span>
                    </AccordionTrigger>
                    <AccordionContent className="pb-2">
                      <div className="max-h-[180px] overflow-y-auto space-y-1 pl-6 pr-2">
                        {pillarChecks.map((check) => (
                          <div
                            key={check.id}
                            className="flex items-start gap-2 rounded-md p-2 hover:bg-muted/50"
                          >
                            {check.passed ? (
                              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
                            ) : (
                              <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-sm">{check.label}</span>
                                {check.value !== undefined && (
                                  <span className="shrink-0 text-xs text-muted-foreground">
                                    {check.value}
                                  </span>
                                )}
                              </div>
                              {check.description && (
                                <p className="mt-0.5 text-xs text-muted-foreground">{check.description}</p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* AI Suggestions */}
      {suggestions.length > 0 && (
        <Card className="border-blue-200 bg-blue-50/50 dark:border-blue-900 dark:bg-blue-950/20">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Lightbulb className="h-4 w-4 text-blue-600" />
              AI Trade Suggestions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {suggestions.map((suggestion, idx) => {
                // Check if suggestion references a specific trade idea
                const matchingIdea = analysis.tradeIdeas.find((idea) =>
                  suggestion.toLowerCase().includes(idea.strategy.toLowerCase().replace(/_/g, " "))
                );

                return (
                  <li
                    key={idx}
                    className={`flex items-start gap-2 text-sm ${
                      matchingIdea ? "cursor-pointer hover:text-blue-600" : ""
                    }`}
                    onClick={() => matchingIdea && onTradeSelect(matchingIdea)}
                  >
                    <span className="mt-0.5 text-blue-600">•</span>
                    <span>
                      {suggestion}
                      {matchingIdea && (
                        <Badge variant="outline" className="ml-2 text-xs">
                          Click to select
                        </Badge>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Selected Trade Indicator */}
      {selectedTrade && (
        <Card className="border-green-200 bg-green-50/50">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm text-green-700">
              <CheckCircle2 className="h-4 w-4" />
              Selected Strategy
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-medium">{selectedTrade.strategyName}</p>
            <p className="text-sm text-muted-foreground">
              R:R {selectedTrade.riskRewardRatio.toFixed(2)} • {selectedTrade.daysToExpiration} DTE
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
