import { useState, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
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
  Info,
  DownloadCloud,
  Network,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TickerSearch } from "@/components/options/TickerSearch";
import { TradeIdeaCard } from "@/components/options/TradeIdeaCard";
import { ProfitLossChart } from "@/components/options/ProfitLossChart";
import { EarningsCalendar } from "@/components/options/EarningsCalendar";
import { SupportResistanceChart } from "@/components/options/SupportResistanceChart";
import { StrategyComparison } from "@/components/options/StrategyComparison";
import { ParityReport } from "@/components/options/ParityReport";
import { ParityAnalysis } from "@/components/options/ParityAnalysis";
import type { TickerAnalysis, TradeIdea } from "@shared/optionsSchema";
import type { ParityAnalysisResponse } from "@/types/parity";

export default function Options() {
  const [selectedTicker, setSelectedTicker] = useState<string>("");
  const [selectedTrade, setSelectedTrade] = useState<TradeIdea | null>(null);
  const [parityThreshold, setParityThreshold] = useState<number>(0.5);

  // Load parity threshold from localStorage
  useEffect(() => {
    const stored = localStorage.getItem("parityThreshold");
    if (stored) {
      setParityThreshold(parseFloat(stored));
    }
  }, []);

  // Save parity threshold to localStorage
  const handleThresholdChange = useCallback((newThreshold: number) => {
    setParityThreshold(newThreshold);
    localStorage.setItem("parityThreshold", newThreshold.toString());
  }, []);

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

  const { data: parityData, isLoading: parityLoading } = useQuery<ParityAnalysisResponse>({
    queryKey: ["/api/options/parity-all", selectedTicker],
    queryFn: async () => {
      if (!selectedTicker) throw new Error("No ticker selected");
      const res = await fetch(
        `/api/options/parity-all/${selectedTicker}?threshold=${parityThreshold}`
      );
      if (!res.ok) throw new Error("Failed to fetch parity data");
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
    <div className="flex-1 space-y-6 overflow-auto p-4 sm:p-8">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Options Trading</h1>
          <p className="text-muted-foreground">
            Analyze options strategies and find profitable trade ideas
          </p>
        </div>
      </div>

      {/* Ticker Search */}
      <Card>
        <CardContent className="pt-6">
          <TickerSearch onSelect={handleTickerSelect} />
        </CardContent>
      </Card>

      {/* Loading State */}
      {isLoading && (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <span className="ml-2 text-muted-foreground">Analyzing {selectedTicker}...</span>
        </div>
      )}

      {/* Error State */}
      {error && (
        <Card className="border-destructive">
          <CardContent className="flex items-center gap-2 py-4 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            <span>Failed to analyze ticker. Please try again.</span>
          </CardContent>
        </Card>
      )}

      {/* Analysis Results */}
      {analysis && !isLoading && (
        <>
          {/* Quote Summary */}
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
                {analysis.upcomingEarnings && (
                  <Badge variant="outline" className="flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    Earnings in {analysis.upcomingEarnings.daysUntil} days
                  </Badge>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Main Content Grid */}
          <div className="grid gap-6 lg:grid-cols-3">
            {/* Left Panel - Trade Ideas */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-lg font-semibold">
                  <Target className="h-5 w-5" />
                  Trade Ideas
                </h3>
              </div>

              {/* Put-Call Parity Threshold Control */}
              <Card>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Info className="h-4 w-4 text-blue-500" />
                    <label className="text-sm font-medium">Parity Threshold</label>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        min="0.1"
                        max="2"
                        step="0.1"
                        value={parityThreshold}
                        onChange={(e) => handleThresholdChange(parseFloat(e.target.value))}
                        className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                      />
                      <span className="text-sm font-semibold w-12 text-right">
                        {parityThreshold.toFixed(1)}%
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Flag arbitrage when deviation exceeds this threshold
                    </p>
                  </div>
                </CardContent>
              </Card>

              <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2">
                {analysis.tradeIdeas.length > 0 ? (
                  analysis.tradeIdeas.map((idea) => (
                    <TradeIdeaCard
                      key={idea.id}
                      idea={idea}
                      selected={selectedTrade?.id === idea.id}
                      parityThreshold={parityThreshold}
                      onClick={() => handleTradeSelect(idea)}
                    />
                  ))
                ) : (
                  <Card>
                    <CardContent className="py-8 text-center text-muted-foreground">
                      No trade ideas available for this ticker
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>

            {/* Center Panel - Charts */}
            <div className="lg:col-span-2 space-y-6">
              <Tabs defaultValue="pl" className="w-full">
                <TabsList className="grid w-full grid-cols-5">
                  <TabsTrigger value="pl" className="flex items-center gap-2">
                    <DollarSign className="h-4 w-4" />
                    <span className="hidden sm:inline">P&L</span>
                  </TabsTrigger>
                  <TabsTrigger value="sr" className="flex items-center gap-2">
                    <BarChart3 className="h-4 w-4" />
                    <span className="hidden sm:inline">S/R</span>
                  </TabsTrigger>
                  <TabsTrigger value="compare" className="flex items-center gap-2">
                    <Target className="h-4 w-4" />
                    <span className="hidden sm:inline">Compare</span>
                  </TabsTrigger>
                  <TabsTrigger value="parity" className="flex items-center gap-2">
                    <Network className="h-4 w-4" />
                    <span className="hidden sm:inline">Parity</span>
                  </TabsTrigger>
                  <TabsTrigger value="reports" className="flex items-center gap-2">
                    <DownloadCloud className="h-4 w-4" />
                    <span className="hidden sm:inline">Reports</span>
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="pl" className="mt-4">
                  <ProfitLossChart
                    trade={selectedTrade}
                    underlyingPrice={analysis.quote.price}
                  />
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

                <TabsContent value="parity" className="mt-4">
                  {parityData ? (
                    <ParityAnalysis
                      pairs={parityData.pairs}
                      threshold={parityThreshold}
                      underlyingPrice={parityData.underlyingPrice}
                      loading={parityLoading}
                    />
                  ) : (
                    <Card>
                      <CardContent className="py-8 text-center text-muted-foreground">
                        Loading parity data...
                      </CardContent>
                    </Card>
                  )}
                </TabsContent>

                <TabsContent value="reports" className="mt-4">
                  <ParityReport ticker={selectedTicker} />
                </TabsContent>
              </Tabs>

              {/* Earnings Alert */}
              {analysis.upcomingEarnings && (
                <EarningsCalendar earnings={analysis.upcomingEarnings} />
              )}
            </div>
          </div>
        </>
      )}

      {/* Empty State */}
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
    </div>
  );
}
