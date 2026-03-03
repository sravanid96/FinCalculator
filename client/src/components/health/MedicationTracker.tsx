import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Pill, Loader2, Clock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { MEAL_TIME_LABELS, type MealTime } from "@shared/healthSchema";

interface Medication {
  id: string;
  name: string;
  dosage: string;
  frequency: string;
  timesOfDay: MealTime[];
  purpose: string | null;
  notes: string | null;
}

const FREQUENCY_OPTIONS = [
  "Once daily",
  "Twice daily",
  "Three times daily",
  "Every other day",
  "Weekly",
  "As needed",
];

const TIME_OPTIONS: MealTime[] = [
  "morning", "with_breakfast", "afternoon", "with_lunch",
  "evening", "with_dinner", "night", "before_bed", "as_needed",
];

export function MedicationTracker() {
  const [name, setName] = useState("");
  const [dosage, setDosage] = useState("");
  const [frequency, setFrequency] = useState("Once daily");
  const [timesOfDay, setTimesOfDay] = useState<MealTime[]>(["morning"]);
  const [purpose, setPurpose] = useState("");
  const [showForm, setShowForm] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: medications, isLoading } = useQuery<Medication[]>({
    queryKey: ["/api/health/medications"],
  });

  const addMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/health/medications", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/health/medications"] });
      resetForm();
      toast({ title: "Medication added" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to add medication", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/health/medications/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/health/medications"] });
      toast({ title: "Medication removed" });
    },
  });

  const resetForm = () => {
    setName("");
    setDosage("");
    setFrequency("Once daily");
    setTimesOfDay(["morning"]);
    setPurpose("");
    setShowForm(false);
  };

  const toggleTime = (time: MealTime) => {
    setTimesOfDay(prev =>
      prev.includes(time)
        ? prev.filter(t => t !== time)
        : [...prev, time]
    );
  };

  const handleAdd = () => {
    if (!name.trim() || !dosage.trim()) return;
    addMutation.mutate({
      name: name.trim(),
      dosage: dosage.trim(),
      frequency,
      timesOfDay,
      purpose: purpose.trim() || null,
    });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Pill className="h-4 w-4" />
              Medications
            </CardTitle>
            <CardDescription>Track your current medications and timing</CardDescription>
          </div>
          {!showForm && (
            <Button variant="outline" size="sm" onClick={() => setShowForm(true)}>
              <Plus className="mr-1 h-4 w-4" />Add
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {showForm && (
          <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="med-name">Medication Name</Label>
                <Input id="med-name" placeholder="e.g., Metformin" value={name} onChange={e => setName(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="med-dosage">Dosage</Label>
                <Input id="med-dosage" placeholder="e.g., 500mg" value={dosage} onChange={e => setDosage(e.target.value)} />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Frequency</Label>
                <Select value={frequency} onValueChange={setFrequency}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FREQUENCY_OPTIONS.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="med-purpose">Purpose (optional)</Label>
                <Input id="med-purpose" placeholder="e.g., Blood sugar control" value={purpose} onChange={e => setPurpose(e.target.value)} />
              </div>
            </div>
            <div>
              <Label>When do you take it?</Label>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {TIME_OPTIONS.map(time => (
                  <Badge
                    key={time}
                    variant={timesOfDay.includes(time) ? "default" : "outline"}
                    className="cursor-pointer"
                    onClick={() => toggleTime(time)}
                  >
                    {MEAL_TIME_LABELS[time]}
                  </Badge>
                ))}
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <Button onClick={handleAdd} disabled={!name.trim() || !dosage.trim() || addMutation.isPending} size="sm">
                {addMutation.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Plus className="mr-1 h-4 w-4" />}
                Add Medication
              </Button>
              <Button variant="ghost" size="sm" onClick={resetForm}>Cancel</Button>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : medications?.length ? (
          <div className="space-y-2">
            {medications.map(med => (
              <div key={med.id} className="flex items-start justify-between rounded-lg border px-3 py-2.5">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{med.name}</span>
                    <span className="text-sm text-muted-foreground">{med.dosage}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />{med.frequency}
                    </span>
                    {(med.timesOfDay || []).map((t: MealTime) => (
                      <Badge key={t} variant="secondary" className="text-xs">
                        {MEAL_TIME_LABELS[t]}
                      </Badge>
                    ))}
                  </div>
                  {med.purpose && (
                    <p className="text-xs text-muted-foreground">For: {med.purpose}</p>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => deleteMutation.mutate(med.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        ) : !showForm ? (
          <p className="text-center text-sm text-muted-foreground py-4">No medications added yet</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
