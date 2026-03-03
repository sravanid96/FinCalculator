import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, AlertCircle, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { CONDITION_PRESETS, type ConditionSeverity } from "@shared/healthSchema";

interface HealthCondition {
  id: string;
  name: string;
  severity: ConditionSeverity;
  diagnosedDate: string | null;
  notes: string | null;
}

const SEVERITY_COLORS: Record<ConditionSeverity, string> = {
  mild: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  moderate: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
  severe: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
};

export function HealthConditionsForm() {
  const [name, setName] = useState("");
  const [severity, setSeverity] = useState<ConditionSeverity>("moderate");
  const [diagnosedDate, setDiagnosedDate] = useState("");
  const [showPresets, setShowPresets] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: conditions, isLoading } = useQuery<HealthCondition[]>({
    queryKey: ["/api/health/conditions"],
  });

  const addMutation = useMutation({
    mutationFn: async (data: { name: string; severity: string; diagnosedDate?: string }) => {
      const res = await apiRequest("POST", "/api/health/conditions", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/health/conditions"] });
      setName("");
      setSeverity("moderate");
      setDiagnosedDate("");
      toast({ title: "Condition added" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to add condition", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/health/conditions/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/health/conditions"] });
      toast({ title: "Condition removed" });
    },
  });

  const handleAdd = () => {
    if (!name.trim()) return;
    addMutation.mutate({
      name: name.trim(),
      severity,
      diagnosedDate: diagnosedDate || undefined,
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertCircle className="h-4 w-4" />
          Health Conditions
        </CardTitle>
        <CardDescription>Add any existing health conditions or diagnoses</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="flex-1">
              <Label htmlFor="condition-name" className="sr-only">Condition</Label>
              <Input
                id="condition-name"
                placeholder="e.g., Type 2 Diabetes, Hypertension..."
                value={name}
                onChange={e => setName(e.target.value)}
                onFocus={() => setShowPresets(true)}
                onKeyDown={e => e.key === "Enter" && handleAdd()}
              />
            </div>
            <Select value={severity} onValueChange={v => setSeverity(v as ConditionSeverity)}>
              <SelectTrigger className="w-[130px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="mild">Mild</SelectItem>
                <SelectItem value="moderate">Moderate</SelectItem>
                <SelectItem value="severe">Severe</SelectItem>
              </SelectContent>
            </Select>
            <Input
              type="date"
              value={diagnosedDate}
              onChange={e => setDiagnosedDate(e.target.value)}
              className="w-[160px]"
              placeholder="Diagnosed date"
            />
            <Button onClick={handleAdd} disabled={!name.trim() || addMutation.isPending} size="icon">
              {addMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            </Button>
          </div>

          {showPresets && !name && (
            <div className="flex flex-wrap gap-1.5">
              {CONDITION_PRESETS.filter(p => !conditions?.some(c => c.name === p)).map(preset => (
                <Badge
                  key={preset}
                  variant="outline"
                  className="cursor-pointer hover:bg-accent"
                  onClick={() => { setName(preset); setShowPresets(false); }}
                >
                  + {preset}
                </Badge>
              ))}
            </div>
          )}
        </div>

        {isLoading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : conditions?.length ? (
          <div className="space-y-2">
            {conditions.map(c => (
              <div key={c.id} className="flex items-center justify-between rounded-lg border px-3 py-2">
                <div className="flex items-center gap-3">
                  <span className="font-medium">{c.name}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${SEVERITY_COLORS[c.severity]}`}>
                    {c.severity}
                  </span>
                  {c.diagnosedDate && (
                    <span className="text-xs text-muted-foreground">since {c.diagnosedDate}</span>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-destructive"
                  onClick={() => deleteMutation.mutate(c.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-center text-sm text-muted-foreground py-4">No conditions added yet</p>
        )}
      </CardContent>
    </Card>
  );
}
