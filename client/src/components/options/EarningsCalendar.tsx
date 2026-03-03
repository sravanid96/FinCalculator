import { Calendar, Clock, DollarSign, AlertTriangle, Sunrise, Sunset } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { EarningsEvent } from "@shared/optionsSchema";

interface EarningsCalendarProps {
  earnings: EarningsEvent;
}

export function EarningsCalendar({ earnings }: EarningsCalendarProps) {
  const reportTimeDisplay = {
    before_market: { label: "Before Market Open", icon: Sunrise, color: "text-orange-500" },
    after_market: { label: "After Market Close", icon: Sunset, color: "text-purple-500" },
    unknown: { label: "Time TBD", icon: Clock, color: "text-gray-500" },
  };

  const timeConfig = reportTimeDisplay[earnings.reportTime];
  const TimeIcon = timeConfig.icon;

  const isUrgent = earnings.daysUntil <= 7;
  const isWarning = earnings.daysUntil <= 21;

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  };

  return (
    <Card className={isUrgent ? "border-red-500/50" : isWarning ? "border-yellow-500/50" : ""}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Calendar className="h-5 w-5" />
            Upcoming Earnings
          </CardTitle>
          {isUrgent && (
            <Badge variant="destructive" className="flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              Earnings Soon!
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Date and Countdown */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-lg font-semibold">{formatDate(earnings.reportDate)}</p>
              <div className={`flex items-center gap-1 text-sm ${timeConfig.color}`}>
                <TimeIcon className="h-4 w-4" />
                {timeConfig.label}
              </div>
            </div>
            <div className="text-right">
              <p className={`text-3xl font-bold ${isUrgent ? "text-red-500" : isWarning ? "text-yellow-500" : "text-primary"}`}>
                {earnings.daysUntil}
              </p>
              <p className="text-sm text-muted-foreground">days until</p>
            </div>
          </div>

          {/* EPS Estimates */}
          {(earnings.estimatedEPS !== undefined || earnings.actualEPS !== undefined) && (
            <div className="grid grid-cols-2 gap-4 rounded-lg bg-muted/50 p-3">
              {earnings.estimatedEPS !== undefined && (
                <div>
                  <p className="text-xs text-muted-foreground">Estimated EPS</p>
                  <p className="flex items-center gap-1 text-lg font-semibold">
                    <DollarSign className="h-4 w-4" />
                    {earnings.estimatedEPS.toFixed(2)}
                  </p>
                </div>
              )}
              {earnings.actualEPS !== undefined && (
                <div>
                  <p className="text-xs text-muted-foreground">Actual EPS</p>
                  <p className="flex items-center gap-1 text-lg font-semibold">
                    <DollarSign className="h-4 w-4" />
                    {earnings.actualEPS.toFixed(2)}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Quarter Info */}
          {earnings.fiscalQuarter && earnings.fiscalQuarter !== "Unknown" && (
            <div className="text-sm text-muted-foreground">
              Fiscal Quarter: <span className="font-medium text-foreground">{earnings.fiscalQuarter}</span>
            </div>
          )}

          {/* Warning Message */}
          {isWarning && (
            <div className={`rounded-md p-3 text-sm ${isUrgent ? "bg-red-500/10 text-red-600" : "bg-yellow-500/10 text-yellow-600"}`}>
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="font-medium">Earnings Risk Warning</p>
                  <p className="mt-1 text-xs opacity-90">
                    {isUrgent
                      ? "Earnings are within 1 week. Consider closing or adjusting positions before the announcement to avoid volatility risk."
                      : "Earnings fall within typical 45 DTE option expiration. Monitor position closely and consider closing at 21 DTE."}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
