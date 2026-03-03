import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, UtensilsCrossed, Loader2, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { MEAL_TYPE_LABELS, type MealType } from "@shared/healthSchema";

interface DietEntry {
  id: string;
  mealType: MealType;
  foods: string[];
  typicalTime: string | null;
  notes: string | null;
}

const MEAL_ICONS: Record<MealType, string> = {
  breakfast: "🌅",
  lunch: "☀️",
  dinner: "🌙",
  snack: "🍎",
  beverage: "🥤",
};

export function DietProfile() {
  const [mealType, setMealType] = useState<MealType>("breakfast");
  const [foods, setFoods] = useState<string[]>([]);
  const [foodInput, setFoodInput] = useState("");
  const [typicalTime, setTypicalTime] = useState("");
  const [showForm, setShowForm] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: entries, isLoading } = useQuery<DietEntry[]>({
    queryKey: ["/api/health/diet"],
  });

  const addMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/health/diet", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/health/diet"] });
      resetForm();
      toast({ title: "Diet entry added" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to add entry", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/health/diet/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/health/diet"] });
      toast({ title: "Entry removed" });
    },
  });

  const resetForm = () => {
    setMealType("breakfast");
    setFoods([]);
    setFoodInput("");
    setTypicalTime("");
    setShowForm(false);
  };

  const addFood = () => {
    const trimmed = foodInput.trim();
    if (trimmed && !foods.includes(trimmed)) {
      setFoods([...foods, trimmed]);
      setFoodInput("");
    }
  };

  const removeFood = (food: string) => {
    setFoods(foods.filter(f => f !== food));
  };

  const handleSubmit = () => {
    if (!foods.length) return;
    addMutation.mutate({
      mealType,
      foods,
      typicalTime: typicalTime || null,
    });
  };

  const grouped = (entries || []).reduce((acc, entry) => {
    if (!acc[entry.mealType]) acc[entry.mealType] = [];
    acc[entry.mealType].push(entry);
    return acc;
  }, {} as Record<string, DietEntry[]>);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <UtensilsCrossed className="h-4 w-4" />
              My Diet
            </CardTitle>
            <CardDescription>Tell us what you generally eat so we can suggest improvements</CardDescription>
          </div>
          {!showForm && (
            <Button variant="outline" size="sm" onClick={() => setShowForm(true)}>
              <Plus className="mr-1 h-4 w-4" />Add Meal
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {showForm && (
          <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Meal Type</Label>
                <Select value={mealType} onValueChange={v => setMealType(v as MealType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(MEAL_TYPE_LABELS) as MealType[]).map(mt => (
                      <SelectItem key={mt} value={mt}>
                        {MEAL_ICONS[mt]} {MEAL_TYPE_LABELS[mt]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Typical Time (optional)</Label>
                <Input
                  type="time"
                  value={typicalTime}
                  onChange={e => setTypicalTime(e.target.value)}
                />
              </div>
            </div>

            <div>
              <Label>Foods you typically eat</Label>
              <div className="mt-1.5 flex gap-2">
                <Input
                  placeholder="e.g., Rice, Dal, Roti, Eggs..."
                  value={foodInput}
                  onChange={e => setFoodInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter") { e.preventDefault(); addFood(); }
                  }}
                />
                <Button variant="outline" size="icon" onClick={addFood} disabled={!foodInput.trim()}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              {foods.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {foods.map(food => (
                    <Badge key={food} variant="secondary" className="gap-1">
                      {food}
                      <button onClick={() => removeFood(food)} className="ml-0.5 hover:text-destructive">
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            <div className="flex gap-2 pt-1">
              <Button onClick={handleSubmit} disabled={!foods.length || addMutation.isPending} size="sm">
                {addMutation.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Plus className="mr-1 h-4 w-4" />}
                Add Entry
              </Button>
              <Button variant="ghost" size="sm" onClick={resetForm}>Cancel</Button>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : Object.keys(grouped).length > 0 ? (
          <div className="space-y-3">
            {(Object.keys(MEAL_TYPE_LABELS) as MealType[]).map(mt => {
              const items = grouped[mt];
              if (!items) return null;
              return (
                <div key={mt}>
                  <h4 className="mb-1.5 text-sm font-medium">
                    {MEAL_ICONS[mt]} {MEAL_TYPE_LABELS[mt]}
                  </h4>
                  {items.map(entry => (
                    <div key={entry.id} className="flex items-start justify-between rounded-lg border px-3 py-2 mb-1.5">
                      <div>
                        <div className="flex flex-wrap gap-1">
                          {(entry.foods || []).map((food, i) => (
                            <Badge key={i} variant="outline" className="text-xs">{food}</Badge>
                          ))}
                        </div>
                        {entry.typicalTime && (
                          <span className="text-xs text-muted-foreground mt-1 block">
                            Usually at {entry.typicalTime}
                          </span>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                        onClick={() => deleteMutation.mutate(entry.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        ) : !showForm ? (
          <p className="text-center text-sm text-muted-foreground py-4">No diet information added yet</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
