import {
  CheckCircle,
  XCircle,
  TrendingUp,
  TrendingDown,
  Target,
  DollarSign,
  Percent,
  AlertTriangle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { cn } from "@/lib/utils";
import type { StrategyComparison as StrategyComparisonType } from "@shared/optionsSchema";

interface StrategyComparisonProps {
  comparisons: StrategyComparisonType[];
}

const recommendationConfig = {
  strong_buy: {
    label: "Strong Buy",
    color: "bg-green-500 text-white",
  },
  buy: {
    label: "Buy",
    color: "bg-green-400 text-white",
  },
  neutral: {
    label: "Neutral",
    color: "bg-yellow-500 text-white",
  },
  avoid: {
    label: "Avoid",
    color: "bg-red-500 text-white",
  },
};

export function StrategyComparison({ comparisons }: StrategyComparisonProps) {
  if (comparisons.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="h-5 w-5" />
            Strategy Comparison
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-[200px] items-center justify-center text-muted-foreground">
            No strategies available to compare
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2">
          <Target className="h-5 w-5" />
          Strategy Comparison
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* Comparison Table */}
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Strategy</TableHead>
                <TableHead className="text-right">Max Profit</TableHead>
                <TableHead className="text-right">Max Loss</TableHead>
                <TableHead className="text-right">POP</TableHead>
                <TableHead className="text-right">Risk:Reward</TableHead>
                <TableHead className="text-right">Capital Req.</TableHead>
                <TableHead className="text-center">Rating</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {comparisons.map((strategy, index) => {
                const rec = recommendationConfig[strategy.recommendation];
                return (
                  <TableRow key={strategy.strategy}>
                    <TableCell className="font-medium">
                      {strategy.strategyName}
                    </TableCell>
                    <TableCell className="text-right text-green-600 font-medium">
                      ${strategy.maxProfit.toFixed(0)}
                    </TableCell>
                    <TableCell className="text-right text-red-600 font-medium">
                      ${Math.abs(strategy.maxLoss).toFixed(0)}
                    </TableCell>
                    <TableCell className="text-right">
                      <span
                        className={cn(
                          "font-medium",
                          strategy.probabilityOfProfit >= 65
                            ? "text-green-600"
                            : strategy.probabilityOfProfit >= 50
                              ? "text-yellow-600"
                              : "text-red-600"
                        )}
                      >
                        {strategy.probabilityOfProfit}%
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      1:{(1 / strategy.riskRewardRatio).toFixed(1)}
                    </TableCell>
                    <TableCell className="text-right">
                      ${strategy.capitalRequired.toFixed(0)}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge className={cn("text-xs", rec.color)}>
                        {rec.label}
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        {/* Strategy Details Accordion */}
        <Accordion type="single" collapsible className="mt-4">
          {comparisons.map((strategy) => (
            <AccordionItem key={strategy.strategy} value={strategy.strategy}>
              <AccordionTrigger className="text-sm">
                {strategy.strategyName} Details
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-4 p-2">
                  {/* Breakeven */}
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Breakeven Price(s)</p>
                    <p className="font-medium">
                      {strategy.breakeven.map((b) => `$${b.toFixed(2)}`).join(" / ")}
                    </p>
                  </div>

                  {/* Pros and Cons */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="mb-2 text-sm font-medium text-green-600 flex items-center gap-1">
                        <CheckCircle className="h-4 w-4" />
                        Advantages
                      </p>
                      <ul className="space-y-1">
                        {strategy.pros.map((pro, index) => (
                          <li
                            key={index}
                            className="flex items-start gap-2 text-sm text-muted-foreground"
                          >
                            <CheckCircle className="mt-0.5 h-3 w-3 shrink-0 text-green-500" />
                            {pro}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <p className="mb-2 text-sm font-medium text-red-600 flex items-center gap-1">
                        <XCircle className="h-4 w-4" />
                        Disadvantages
                      </p>
                      <ul className="space-y-1">
                        {strategy.cons.map((con, index) => (
                          <li
                            key={index}
                            className="flex items-start gap-2 text-sm text-muted-foreground"
                          >
                            <XCircle className="mt-0.5 h-3 w-3 shrink-0 text-red-500" />
                            {con}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  {/* Quick Metrics */}
                  <div className="grid grid-cols-4 gap-2 rounded-lg bg-muted/50 p-3">
                    <div className="text-center">
                      <p className="text-xs text-muted-foreground">Return on Risk</p>
                      <p className="font-semibold">
                        {((strategy.maxProfit / Math.abs(strategy.maxLoss)) * 100).toFixed(1)}%
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="text-xs text-muted-foreground">Win Rate Needed</p>
                      <p className="font-semibold">
                        {(
                          (Math.abs(strategy.maxLoss) /
                            (strategy.maxProfit + Math.abs(strategy.maxLoss))) *
                          100
                        ).toFixed(0)}
                        %
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="text-xs text-muted-foreground">Expected Value</p>
                      <p
                        className={cn(
                          "font-semibold",
                          (strategy.maxProfit * (strategy.probabilityOfProfit / 100) -
                            Math.abs(strategy.maxLoss) *
                              (1 - strategy.probabilityOfProfit / 100)) >
                            0
                            ? "text-green-600"
                            : "text-red-600"
                        )}
                      >
                        $
                        {(
                          strategy.maxProfit * (strategy.probabilityOfProfit / 100) -
                          Math.abs(strategy.maxLoss) * (1 - strategy.probabilityOfProfit / 100)
                        ).toFixed(0)}
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="text-xs text-muted-foreground">ROI (on capital)</p>
                      <p className="font-semibold">
                        {((strategy.maxProfit / strategy.capitalRequired) * 100).toFixed(1)}%
                      </p>
                    </div>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>

        {/* Strategy Selection Guide */}
        <div className="mt-4 rounded-lg bg-blue-500/10 p-3">
          <h4 className="mb-2 flex items-center gap-2 text-sm font-medium text-blue-600">
            <Target className="h-4 w-4" />
            Strategy Selection Guide
          </h4>
          <ul className="space-y-1 text-xs text-muted-foreground">
            <li>
              <strong>Put Credit Spread:</strong> Best for bullish to neutral outlook with defined risk
            </li>
            <li>
              <strong>Call Credit Spread:</strong> Best for bearish to neutral outlook with defined risk
            </li>
            <li>
              <strong>Iron Condor:</strong> Best for low volatility, range-bound markets
            </li>
            <li>
              <strong>Cash Secured Put:</strong> Best when willing to own shares at a lower price
            </li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
