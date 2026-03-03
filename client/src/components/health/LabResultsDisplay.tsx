import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { FileText, Trash2, Calendar, Building2, AlertTriangle, CheckCircle, ArrowUp, ArrowDown, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { ParsedLabResult } from "@shared/healthSchema";

interface LabReport {
  id: string;
  fileName: string;
  reportDate: string | null;
  labName: string | null;
  parsedResults: ParsedLabResult[];
  createdAt: string;
}

function FlagBadge({ flag }: { flag: ParsedLabResult["flag"] }) {
  switch (flag) {
    case "critical_high":
      return <Badge variant="destructive" className="gap-1"><ArrowUp className="h-3 w-3" />Critical High</Badge>;
    case "critical_low":
      return <Badge variant="destructive" className="gap-1"><ArrowDown className="h-3 w-3" />Critical Low</Badge>;
    case "high":
      return <Badge className="gap-1 bg-orange-500 hover:bg-orange-600"><ArrowUp className="h-3 w-3" />High</Badge>;
    case "low":
      return <Badge className="gap-1 bg-amber-500 hover:bg-amber-600"><ArrowDown className="h-3 w-3" />Low</Badge>;
    case "normal":
      return <Badge variant="outline" className="gap-1 border-green-500 text-green-600"><CheckCircle className="h-3 w-3" />Normal</Badge>;
    default:
      return null;
  }
}

export function LabResultsDisplay() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: reports, isLoading } = useQuery<LabReport[]>({
    queryKey: ["/api/health/lab-reports"],
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/health/lab-reports/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/health/lab-reports"] });
      toast({ title: "Report deleted" });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!reports?.length) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <FileText className="h-12 w-12 text-muted-foreground/50" />
        <p className="mt-3 text-sm text-muted-foreground">No lab reports uploaded yet</p>
        <p className="text-xs text-muted-foreground">Upload a PDF to get started</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {reports.map((report) => {
        const results = report.parsedResults || [];
        const abnormal = results.filter(r => r.flag !== "normal");
        const categories = Array.from(new Set(results.map(r => r.category)));

        return (
          <Card key={report.id}>
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <FileText className="h-4 w-4" />
                    {report.fileName}
                  </CardTitle>
                  <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                    {report.reportDate && (
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />{report.reportDate}
                      </span>
                    )}
                    {report.labName && (
                      <span className="flex items-center gap-1">
                        <Building2 className="h-3 w-3" />{report.labName}
                      </span>
                    )}
                    <span>{results.length} tests</span>
                    {abnormal.length > 0 && (
                      <span className="flex items-center gap-1 text-orange-500">
                        <AlertTriangle className="h-3 w-3" />{abnormal.length} abnormal
                      </span>
                    )}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  onClick={() => deleteMutation.mutate(report.id)}
                  disabled={deleteMutation.isPending}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {categories.map(category => {
                const catResults = results.filter(r => r.category === category);
                return (
                  <div key={category} className="mb-4 last:mb-0">
                    <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{category}</h4>
                    <div className="overflow-hidden rounded-md border">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b bg-muted/50">
                            <th className="px-3 py-2 text-left font-medium">Test</th>
                            <th className="px-3 py-2 text-left font-medium">Result</th>
                            <th className="px-3 py-2 text-left font-medium">Reference</th>
                            <th className="px-3 py-2 text-left font-medium">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {catResults.map((result, i) => (
                            <tr key={i} className={`border-b last:border-0 ${result.flag !== "normal" ? "bg-orange-50/50 dark:bg-orange-950/10" : ""}`}>
                              <td className="px-3 py-2 font-medium">{result.testName}</td>
                              <td className="px-3 py-2">
                                {result.value} <span className="text-muted-foreground">{result.unit}</span>
                              </td>
                              <td className="px-3 py-2 text-muted-foreground">{result.referenceRange}</td>
                              <td className="px-3 py-2"><FlagBadge flag={result.flag} /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
