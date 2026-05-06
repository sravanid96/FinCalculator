import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Search,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Calendar,
  Target,
  DollarSign,
  BarChart3,
  Loader2,
  BookOpen,
  ClipboardList,
  Shield,
  Bookmark,
  BarChart2,
  Filter,
  GitCompareArrows,
} from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TickerSearch } from "@/components/options/TickerSearch";
import { TradeIdeaCard } from "@/components/options/TradeIdeaCard";
import { ProfitLossChart } from "@/components/options/ProfitLossChart";
import { EarningsCalendar } from "@/components/options/EarningsCalendar";
import { SupportResistanceChart } from "@/components/options/SupportResistanceChart";
import { StrategyComparison } from "@/components/options/StrategyComparison";
import { TradingDecisionFramework } from "@/components/options/TradingDecisionFramework";
import { TradeLog } from "@/components/options/TradeLog";
import { FrameworkTradeAnalyzer } from "@/components/options/FrameworkTradeAnalyzer";
import { TechnicalIndicatorsChart } from "@/components/options/TechnicalIndicatorsChart";
import { TopTradeIdeasTab } from "@/components/options/TopTradeIdeasTab";
import { IdeaWatchlistTab, addIdeaToWatchlist } from "@/components/options/IdeaWatchlistTab";
import { BacktestTab } from "@/components/options/BacktestTab";
import { BacktestSummary } from "@/components/options/BacktestSummary";
import { ScreenerTab } from "@/components/options/ScreenerTab";
import { CompareTab } from "@/components/options/CompareTab";
import { useToast } from "@/hooks/use-toast";
import type { TickerAnalysis, TradeIdea } from "@shared/optionsSchema";

export default function Options() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedTicker, setSelectedTicker] = useState<string>("");
  const [selectedTrade, setSelectedTrade] = useState<TradeIdea | null>(null);
  const [activeTab, setActiveTab] = useState<
    "analysis" | "ideas" | "backtest" | "screener" | "compare" | "watchlist" | "framework" | "journal"
  >("analysis");

  const addWatchMut = useMutation({
    mutationFn: async (payload: { symbol: string; idea: TradeIdea }) =>
      addIdeaToWatchlist(payload.symbol, payload.idea),
    onSuccess: () => {
      toast({ title: "Added to watchlist" });
      queryClient.invalidateQueries({ queryKey: ["/api/options/watchlist"] });
    },
    onError: (e: Error) => {
      toast({ title: "Could not add", description: e.message, variant: "destructive" });
    },
  });

  const { data: analysis, isLoading, error } = useQuery<TickerAnalysis>({
    queryKey: ["/api/options/analysis", selectedTicker],
    queryFn: async () => {
      if (!selectedTicker) throw new Error("No ticker selected");
      const res = await fetch(`/api/options/analysis/${selectedTicker}`);
      if (!res.ok) throw new Error("Failed to fetch analysis");
      return res.json();
    },
    enabled: !!selectedTicker,
    staleTime: 60 * 1000,
    retry: 1,
  });

  const handleTickerSelect = useCallback((ticker: string) => {
    setSelectedTicker(ticker);
    setSelectedTrade(null);
  }, []);

  const handleTradeSelect = useCallback((trade: TradeIdea) => {
    setSelectedTrade(trade);
  }, []);

  return (
    <div className="space-y-6 p-4 sm:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Options Trading</h1>
          <p className="text-muted-foreground">
            Analysis tools, a decision framework for any market, and a trade journal with performance
            stats
          </p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="space-y-6">
        <TabsList className="grid w-full max-w-6xl grid-cols-8">
          <TabsTrigger value="analysis" className="gap-1.5">
            <BarChart3 className="h-4 w-4" />
            Analysis
          </TabsTrigger>
          <TabsTrigger value="ideas" className="gap-1.5">
            <Shield className="h-4 w-4" />
            Ideas
          </TabsTrigger>
          <TabsTrigger value="backtest" className="gap-1.5">
            <BarChart2 className="h-4 w-4" />
            Backtest
          </TabsTrigger>
          <TabsTrigger value="screener" className="gap-1.5">
            <Filter className="h-4 w-4" />
            Screener
          </TabsTrigger>
          <TabsTrigger value="compare" className="gap-1.5">
            <GitCompareArrows className="h-4 w-4" />
            Compare
          </TabsTrigger>
          <TabsTrigger value="watchlist" className="gap-1.5">
            <Bookmark className="h-4 w-4" />
            Watchlist
          </TabsTrigger>
          <TabsTrigger value="framework" className="gap-1.5">
            <BookOpen className="h-4 w-4" />
            Framework
          </TabsTrigger>
          <TabsTrigger value="journal" className="gap-1.5">
            <ClipboardList className="h-4 w-4" />
            Trade log
          </TabsTrigger>
        </TabsList>

        <TabsContent value="analysis" className="mt-0 space-y-6">
          <Card>
            <CardContent className="pt-6">
              <TickerSearch onSelect={handleTickerSelect} />
            </CardContent>
          </Card>

          {isLoading && (
            <div className="flex h-64 items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <span className="ml-2 text-muted-foreground">Analyzing {selectedTicker}...</span>
            </div>
          )}

          {error && (
            <Card className="border-destructive">
              <CardContent className="flex items-center gap-2 py-4 text-destructive">
                <AlertTriangle className="h-5 w-5" />
                <span>Failed to analyze ticker. Please try again.</span>
              </CardContent>
            </Card>
          )}

          {analysis && !isLoading && (
            <>
              {/* Quote Header */}
              <Card>
                <CardContent className="py-4">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                      <div>
                        <h2 className="text-2xl font-bold">{analysis.quote.symbol}</h2>
                        <p className="text-sm text-muted-foreground">{analysis.quote.name}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-2xl font-bold">${analysis.quote.price.toFixed(2)}</p>
                        <p
                          className={`flex items-center gap-1 text-sm ${
                            analysis.quote.change >= 0 ? "text-green-500" : "text-red-500"
                          }`}
                        >
                          {analysis.quote.change >= 0 ? (
                            <TrendingUp className="h-4 w-4" />
                          ) : (
                            <TrendingDown className="h-4 w-4" />
                          )}
                          {analysis.quote.change >= 0 ? "+" : ""}
                          {analysis.quote.change.toFixed(2)} ({analysis.quote.changePercent.toFixed(2)}%)
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-4 text-sm">
                      {analysis.quote.high52Week && (
                        <div>
                          <span className="text-muted-foreground">52W High:</span>{" "}
                          <span className="font-medium">${analysis.quote.high52Week.toFixed(2)}</span>
                        </div>
                      )}
                      {analysis.quote.low52Week && (
                        <div>
                          <span className="text-muted-foreground">52W Low:</span>{" "}
                          <span className="font-medium">${analysis.quote.low52Week.toFixed(2)}</span>
                        </div>
                      )}
                      {analysis.quote.pe && (
                        <div>
                          <span className="text-muted-foreground">P/E:</span>{" "}
                          <span className="font-medium">{analysis.quote.pe.toFixed(2)}</span>
                        </div>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {analysis.upcomingEarnings && (
                        <Badge variant="outline" className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          Earnings in {analysis.upcomingEarnings.daysUntil} days
                        </Badge>
                      )}
                      {analysis.frameworkAnalysis?.indicators?.rsi !== null &&
                        analysis.frameworkAnalysis?.indicators?.rsi !== undefined && (
                          <Badge
                            variant="outline"
                            className={`flex items-center gap-1 ${
                              analysis.frameworkAnalysis.indicators.rsi > 70
                                ? "border-red-300 bg-red-500/10 text-red-700"
                                : analysis.frameworkAnalysis.indicators.rsi < 30
                                  ? "border-green-300 bg-green-500/10 text-green-700"
                                  : "border-blue-300 bg-blue-500/10 text-blue-700"
                            }`}
                          >
                            <span className="font-semibold">
                              RSI {analysis.frameworkAnalysis.indicators.rsi.toFixed(1)}
                            </span>
                            {analysis.frameworkAnalysis.indicators.rsi > 70
                              ? "(OB)"
                              : analysis.frameworkAnalysis.indicators.rsi < 30
                                ? "(OS)"
                                : ""}
                          </Badge>
                        )}
                      {analysis.upcomingEarnings && analysis.upcomingEarnings.daysUntil <= 21 && (
                        <Badge
                          variant="secondary"
                          className="border border-yellow-300 bg-yellow-500/10 text-yellow-700"
                        >
                          Elevated earnings risk (≤ 21 days)
                        </Badge>
                      )}
                      {selectedTrade?.hasEarningsRisk && (
                        <Badge className="bg-red-600 text-white">Selected trade has earnings risk</Badge>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <div className="grid gap-6 lg:grid-cols-3">
                {/* Left Panel - Framework Analysis, Backtest Summary & Trade Ideas */}
                <div className="space-y-4">
                  {/* Historical Performance Summary */}
                  <BacktestSummary
                    symbol={analysis.quote.symbol}
                    currentStrategy={selectedTrade?.strategy}
                  />

                  {/* Framework Trade Analyzer */}
                  <FrameworkTradeAnalyzer
                    analysis={analysis}
                    selectedTrade={selectedTrade}
                    onTradeSelect={handleTradeSelect}
                  />

                  {/* Trade Ideas Section - Isolated Scrollable */}
                  <Card className="overflow-hidden">
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <h3 className="flex items-center gap-2 text-base font-semibold">
                          <Target className="h-4 w-4" />
                          Trade Ideas
                        </h3>
                        <Badge variant="secondary" className="text-xs">
                          {analysis.tradeIdeas.length} strategies
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="p-0">
                      <ScrollArea className="h-[320px]">
                        <div className="space-y-3 p-4 pt-0">
                          {analysis.tradeIdeas.length > 0 ? (
                            analysis.tradeIdeas.map((idea) => (
                              <TradeIdeaCard
                                key={idea.id}
                                idea={idea}
                                selected={selectedTrade?.id === idea.id}
                                onClick={() => handleTradeSelect(idea)}
                                onAddToWatchlist={() =>
                                  addWatchMut.mutate({
                                    symbol: analysis.quote.symbol,
                                    idea,
                                  })
                                }
                                watchlistBusy={addWatchMut.isPending}
                              />
                            ))
                          ) : (
                            <div className="py-8 text-center text-sm text-muted-foreground">
                              No trade ideas available for this ticker
                            </div>
                          )}
                        </div>
                      </ScrollArea>
                    </CardContent>
                  </Card>
                </div>

                {/* Right Panel - Charts & Analysis */}
                <div className="space-y-6 lg:col-span-2">
                  <Tabs defaultValue="pl" className="w-full">
                    <TabsList className="grid w-full grid-cols-3">
                      <TabsTrigger value="pl" className="flex items-center gap-2">
                        <DollarSign className="h-4 w-4" />
                        P&L Chart
                      </TabsTrigger>
                      <TabsTrigger value="sr" className="flex items-center gap-2">
                        <BarChart3 className="h-4 w-4" />
                        Support/Resistance
                      </TabsTrigger>
                      <TabsTrigger value="compare" className="flex items-center gap-2">
                        <Target className="h-4 w-4" />
                        Compare
                      </TabsTrigger>
                    </TabsList>

                    <TabsContent value="pl" className="mt-4">
                      <ProfitLossChart trade={selectedTrade} underlyingPrice={analysis.quote.price} />
                    </TabsContent>

                    <TabsContent value="sr" className="mt-4">
                      <SupportResistanceChart
                        levels={analysis.supportResistance}
                        currentPrice={analysis.quote.price}
                        symbol={analysis.quote.symbol}
                      />
                    </TabsContent>

                    <TabsContent value="compare" className="mt-4">
                      <StrategyComparison comparisons={analysis.strategyComparisons} />
                    </TabsContent>
                  </Tabs>

                  {/* Technical Indicators Chart */}
                  <TechnicalIndicatorsChart
                    symbol={analysis.quote.symbol}
                    currentPrice={analysis.quote.price}
                    levels={analysis.supportResistance}
                  />

                  {analysis.upcomingEarnings && (
                    <EarningsCalendar earnings={analysis.upcomingEarnings} />
                  )}
                </div>
              </div>
            </>
          )}

          {!selectedTicker && !isLoading && (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-16">
                <Search className="mb-4 h-12 w-12 text-muted-foreground" />
                <h3 className="text-lg font-semibold">Search for a Ticker</h3>
                <p className="text-center text-muted-foreground">
                  Enter a stock symbol above to analyze options strategies and find trade ideas
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="ideas" className="mt-0 space-y-6">
          <TopTradeIdeasTab
            onAnalyzeSymbol={(symbol) => {
              handleTickerSelect(symbol);
              setActiveTab("analysis");
            }}
          />
        </TabsContent>

        <TabsContent value="backtest" className="mt-0 space-y-6">
          <BacktestTab
            onAnalyzeSymbol={(symbol) => {
              handleTickerSelect(symbol);
              setActiveTab("analysis");
            }}
          />
        </TabsContent>

        <TabsContent value="screener" className="mt-0 space-y-6">
          <ScreenerTab />
        </TabsContent>

        <TabsContent value="compare" className="mt-0 space-y-6">
          <CompareTab />
        </TabsContent>

        <TabsContent value="watchlist" className="mt-0 space-y-6">
          <IdeaWatchlistTab />
        </TabsContent>

        <TabsContent value="framework" className="mt-0">
          <TradingDecisionFramework />
        </TabsContent>

        <TabsContent value="journal" className="mt-0">
          <TradeLog />
        </TabsContent>
      </Tabs>
    </div>
  );
}
