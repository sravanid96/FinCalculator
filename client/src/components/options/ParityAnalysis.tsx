import { useState, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowUpDown, TrendingUp, AlertTriangle, ShieldAlert } from "lucide-react";
import type { ParityPair } from "@/types/parity";

interface ParityAnalysisProps {
  pairs: ParityPair[];
  threshold: number;
  underlyingPrice: number;
  loading?: boolean;
}

type SortField = "strike" | "call-price" | "put-price" | "arbitrage" | "violation";
type SortOrder = "asc" | "desc";

export function ParityAnalysis({
  pairs,
  threshold,
  underlyingPrice,
  loading = false,
}: ParityAnalysisProps) {
  const [sortField, setSortField] = useState<SortField>("violation");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [selectedExpiration, setSelectedExpiration] = useState<string>("all");

  // Get unique expirations
  const expirations = useMemo(() => {
    return [...new Set(pairs.map((p) => p.expiration))];
  }, [pairs]);

  // Filter and sort pairs
  const filteredAndSorted = useMemo(() => {
    let filtered = pairs;

    if (selectedExpiration && selectedExpiration !== "all") {
      filtered = filtered.filter((p) => p.expiration === selectedExpiration);
    }

    // Sort
    const sorted = [...filtered].sort((a, b) => {
      let aVal: number;
      let bVal: number;

      switch (sortField) {
        case "strike":
          aVal = a.strike;
          bVal = b.strike;
          break;
        case "call-price":
          aVal = a.callPrice;
          bVal = b.callPrice;
          break;
        case "put-price":
          aVal = a.putPrice;
          bVal = b.putPrice;
          break;
        case "arbitrage":
          aVal = a.parityMetrics.arbitrageProfitPercent;
          bVal = b.parityMetrics.arbitrageProfitPercent;
          break;
        case "violation":
          aVal = Math.abs(a.parityMetrics.purityViolation);
          bVal = Math.abs(b.parityMetrics.purityViolation);
          break;
        default:
          return 0;
      }

      return sortOrder === "asc" ? aVal - bVal : bVal - aVal;
    });

    return sorted;
  }, [pairs, selectedExpiration, sortField, sortOrder]);

  const getParityBadgeColor = (
    maxDeviation: number,
    direction: "call_expensive" | "put_expensive" | "fair"
  ): string => {
    if (maxDeviation <= threshold) return "bg-green-500 text-white";
    if (direction === "put_expensive") return "bg-red-600 text-white";
    if (direction === "call_expensive") return "bg-yellow-500 text-white";
    return "bg-green-500 text-white";
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortOrder("desc");
    }
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>All Parity Pairs</CardTitle>
          <CardDescription>Loading options chain data...</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-gray-500">Loading parity analysis...</div>
        </CardContent>
      </Card>
    );
  }

  if (pairs.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>All Parity Pairs</CardTitle>
          <CardDescription>All available call-put combinations</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-gray-500">
            No pairs found or options chain data unavailable
          </div>
        </CardContent>
      </Card>
    );
  }

  const violations = filteredAndSorted.filter((p) => {
    const maxDev = Math.max(
      Math.abs(p.parityMetrics.callPriceDeviation),
      Math.abs(p.parityMetrics.putPriceDeviation)
    );
    return maxDev > threshold;
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>All Parity Pairs</CardTitle>
            <CardDescription>
              {filteredAndSorted.length} pairs • {violations.length} above threshold
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Select value={selectedExpiration} onValueChange={setSelectedExpiration}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="All Expirations" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Expirations</SelectItem>
                {expirations.map((exp) => (
                  <SelectItem key={exp} value={exp}>
                    {exp}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-2 sm:px-4">
        <div className="overflow-x-auto max-h-[460px]">
          <Table className="text-xs sm:text-sm">
            <TableHeader>
              <TableRow>
                <TableHead
                  className="cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort("strike")}
                >
                  <div className="flex items-center gap-1">
                    Strike
                    {sortField === "strike" && (
                      <ArrowUpDown className="h-4 w-4" />
                    )}
                  </div>
                </TableHead>
                <TableHead
                  className="cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort("call-price")}
                >
                  <div className="flex items-center gap-1">
                    Call Price
                    {sortField === "call-price" && (
                      <ArrowUpDown className="h-4 w-4" />
                    )}
                  </div>
                </TableHead>
                <TableHead
                  className="cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort("put-price")}
                >
                  <div className="flex items-center gap-1">
                    Put Price
                    {sortField === "put-price" && (
                      <ArrowUpDown className="h-4 w-4" />
                    )}
                  </div>
                </TableHead>
                <TableHead className="text-center">Call Dev %</TableHead>
                <TableHead className="text-center">Put Dev %</TableHead>
                <TableHead
                  className="cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort("arbitrage")}
                >
                  <div className="flex items-center justify-end gap-1">
                    Arbitrage %
                    {sortField === "arbitrage" && (
                      <ArrowUpDown className="h-4 w-4" />
                    )}
                  </div>
                </TableHead>
                <TableHead
                  className="cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort("violation")}
                >
                  <div className="flex items-center justify-end gap-1">
                    Status
                    {sortField === "violation" && (
                      <ArrowUpDown className="h-4 w-4" />
                    )}
                  </div>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredAndSorted.map((pair) => {
                const maxDeviation = Math.max(
                  Math.abs(pair.parityMetrics.callPriceDeviation),
                  Math.abs(pair.parityMetrics.putPriceDeviation)
                );
                const isViolation = maxDeviation > threshold;
                const rawCallDev = pair.parityMetrics.callPriceDeviation;
                const rawPutDev = pair.parityMetrics.putPriceDeviation;
                const callDev =
                  rawCallDev !== null && Number.isFinite(rawCallDev) ? rawCallDev : null;
                const putDev =
                  rawPutDev !== null && Number.isFinite(rawPutDev) ? rawPutDev : null;
                const direction = pair.parityMetrics.direction;

                // Row styling: dark background with colored left border
                const baseRowClass = "bg-black";
                const rowClass = !isViolation
                  ? baseRowClass
                  : direction === "put_expensive"
                  ? `${baseRowClass} border-l-4 border-red-400`
                  : direction === "call_expensive"
                  ? `${baseRowClass} border-l-4 border-amber-400`
                  : `${baseRowClass} border-l-4 border-emerald-400`;

                return (
                  <TableRow
                    key={`${pair.expiration}-${pair.strike}`}
                    className={rowClass}
                  >
                    <TableCell className="font-mono font-semibold">
                      ${pair.strike.toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right">${pair.callPrice.toFixed(2)}</TableCell>
                    <TableCell className="text-right">${pair.putPrice.toFixed(2)}</TableCell>
                    <TableCell className="text-center">
                      {callDev === null ? (
                        <span className="text-xs text-muted-foreground">N/A</span>
                      ) : (
                        <span
                          className={callDev > 0 ? "text-red-600 font-semibold" : "text-green-600"}
                        >
                          {callDev > 0 ? "+" : ""}
                          {callDev.toFixed(2)}%
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex flex-col items-center gap-0.5">
                        {putDev === null ? (
                          <>
                            <span className="text-xs text-muted-foreground">N/A</span>
                            <span className="text-[11px] text-muted-foreground">No parity signal</span>
                          </>
                        ) : (
                          <>
                            <span
                              className={
                                putDev > 0
                                  ? "text-red-600 font-semibold"
                                  : "text-green-600 font-semibold"
                              }
                            >
                              {putDev > 0 ? "+" : ""}
                              {putDev.toFixed(2)}%
                            </span>
                            <span className="text-[11px] text-muted-foreground">
                              {putDev > 0 ? "Put premium rich" : "Put premium cheap"}
                            </span>
                          </>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      {pair.parityMetrics.arbitrageProfitPercent > 0 ? (
                        <div className="flex items-center justify-end gap-1">
                          <TrendingUp className="h-4 w-4 text-green-600" />
                          <span className="font-semibold text-green-600">
                            {pair.parityMetrics.arbitrageProfitPercent.toFixed(3)}%
                          </span>
                        </div>
                      ) : (
                        <span className="text-gray-500">
                          {pair.parityMetrics.arbitrageProfitPercent.toFixed(3)}%
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-col items-end gap-1">
                        <Badge className={getParityBadgeColor(maxDeviation, direction)}>
                          {direction === "put_expensive" && (
                            <div className="flex items-center gap-1">
                              <ShieldAlert className="h-3 w-3" />
                              Put expensive
                            </div>
                          )}
                          {direction === "call_expensive" && (
                            <div className="flex items-center gap-1">
                              <AlertTriangle className="h-3 w-3" />
                              Call expensive
                            </div>
                          )}
                          {direction === "fair" && `${maxDeviation.toFixed(2)}%`}
                        </Badge>
                        <span className="text-[11px] text-muted-foreground">
                          Extra arb premium: ${pair.parityMetrics.arbitrageProfitDollars.toFixed(2)}
                        </span>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        {filteredAndSorted.length === 0 && (
          <div className="text-center py-8 text-gray-500">
            No pairs match the selected filters
          </div>
        )}
      </CardContent>
    </Card>
  );
}
