import { useState, useEffect } from "react";
import { DownloadCloud, Bell, TrendingUp, TrendingDown, Calendar } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface ParityReportProps {
  ticker?: string;
}

export function ParityReport({ ticker }: ParityReportProps) {
  const [statisticsData, setStatisticsData] = useState<any>(null);
  const [isLoadingStats, setIsLoadingStats] = useState(false);

  // Fetch statistics when ticker changes
  useEffect(() => {
    if (ticker) {
      setIsLoadingStats(true);
      fetch(`/api/options/parity-export/stats/${ticker}?hours=24`)
        .then((res) => res.json())
        .then((data) => setStatisticsData(data))
        .catch((err) => console.error("Error fetching parity stats:", err))
        .finally(() => setIsLoadingStats(false));
    }
  }, [ticker]);

  const downloadCSV = async () => {
    if (!ticker) return;
    try {
      const response = await fetch(`/api/options/parity-export/csv/${ticker}?hours=24`);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `parity-${ticker}-${new Date().toISOString().split("T")[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Error downloading CSV:", error);
    }
  };

  if (!ticker) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center py-8 text-muted-foreground">
          <DownloadCloud className="h-8 w-8 mb-2" />
          <p>Select a ticker to view parity reports and export data</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Statistics Card */}
      {statisticsData && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-4 w-4" />
              Put-Call Parity Statistics (24h)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-muted-foreground">Data Points</p>
                <p className="font-semibold text-lg">
                  {statisticsData.statistics.totalDataPoints}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Avg Arbitrage %</p>
                <p className="font-semibold text-green-600">
                  {statisticsData.statistics.avgArbitrageOpportunity.toFixed(3)}%
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Max Arbitrage %</p>
                <p className="font-semibold text-green-600">
                  {statisticsData.statistics.maxArbitrageOpportunity.toFixed(3)}%
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Violations (&gt;0.5%)</p>
                <p className="font-semibold">
                  {statisticsData.statistics.violationCount}
                </p>
              </div>
            </div>

            {/* Recent entries */}
            {statisticsData.recentEntries && statisticsData.recentEntries.length > 0 && (
              <div className="border-t pt-3">
                <p className="text-xs font-semibold text-muted-foreground mb-2">
                  Recent Parity Events
                </p>
                <div className="space-y-2">
                  {statisticsData.recentEntries.slice(-3).map((entry: any, idx: number) => (
                    <div key={idx} className="flex items-center justify-between text-xs bg-gray-50 dark:bg-gray-900 p-2 rounded">
                      <span className="text-muted-foreground">
                        {entry.daysToExp} DTE
                      </span>
                      <span className="font-medium">
                        {entry.arbitrageProfit > 0 ? "+" : ""}
                        {entry.arbitrageProfit.toFixed(3)}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Export Buttons */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <DownloadCloud className="h-4 w-4" />
            Export Parity Data
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Button
            onClick={downloadCSV}
            disabled={!ticker || isLoadingStats}
            className="w-full justify-center gap-2"
            variant="outline"
          >
            <DownloadCloud className="h-4 w-4" />
            Export as CSV (24h)
          </Button>
          <p className="text-xs text-muted-foreground text-center">
            Download parity analysis data for backtesting and analysis
          </p>
        </CardContent>
      </Card>

      {/* Alert Info */}
      <Card className="border-blue-200 bg-blue-50 dark:bg-blue-950 dark:border-blue-800">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base text-blue-900 dark:text-blue-100">
            <Bell className="h-4 w-4" />
            Parity Alerts Active
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-blue-800 dark:text-blue-200">
            Alerts are being tracked for parity violations exceeding 0.5%. Export data includes
            all recorded events for the selected period.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
