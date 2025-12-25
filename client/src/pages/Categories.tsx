import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Tag, GripVertical } from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { CategoryBadge } from "@/components/CategoryBadge";
import { EmptyState } from "@/components/EmptyState";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { SortableCategoryItem } from "@/components/SortableCategoryItem";
import type { Category } from "@shared/schema";

interface CategoriesResponse {
  categories: Category[];
}

const CATEGORY_COLORS = [
  "#6366f1",
  "#8b5cf6",
  "#ec4899",
  "#f43f5e",
  "#f59e0b",
  "#10b981",
  "#06b6d4",
  "#3b82f6",
  "#84cc16",
  "#14b8a6",
  "#a855f7",
  "#64748b",
];

const CATEGORY_TYPES = [
  { value: "expense", label: "Expense" },
  { value: "income", label: "Income" },
  { value: "savings", label: "Savings" },
  { value: "investment", label: "Investment" },
];

export default function Categories() {
  const { toast } = useToast();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [deletingCategory, setDeletingCategory] = useState<Category | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    type: "expense",
    color: CATEGORY_COLORS[0],
  });

  const { data, isLoading } = useQuery<CategoriesResponse>({
    queryKey: ["/api/categories"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: { name: string; type: string; color: string }) => {
      await apiRequest("POST", "/api/categories", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/categories"] });
      setIsCreateOpen(false);
      resetForm();
      toast({ title: "Category created" });
    },
    onError: () => {
      toast({ title: "Failed to create category", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: {
      id: string;
      updates: { name?: string; type?: string; color?: string };
    }) => {
      await apiRequest("PATCH", `/api/categories/${data.id}`, data.updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/categories"] });
      setEditingCategory(null);
      resetForm();
      toast({ title: "Category updated" });
    },
    onError: () => {
      toast({ title: "Failed to update category", variant: "destructive" });
    },
  });

  const updateTypeMutation = useMutation({
    mutationFn: async (data: { id: string; type: string }) => {
      await apiRequest("PATCH", `/api/categories/${data.id}`, { type: data.type });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/categories"] });
      toast({ title: "Category moved" });
    },
    onError: () => {
      toast({ title: "Failed to move category", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/categories/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/categories"] });
      setDeletingCategory(null);
      toast({ title: "Category deleted" });
    },
    onError: () => {
      toast({ title: "Failed to delete category", variant: "destructive" });
    },
  });

  const resetForm = () => {
    setFormData({
      name: "",
      type: "expense",
      color: CATEGORY_COLORS[0],
    });
  };

  const handleEdit = (category: Category) => {
    setEditingCategory(category);
    setFormData({
      name: category.name,
      type: category.type,
      color: category.color || CATEGORY_COLORS[0],
    });
  };

  const handleSave = () => {
    if (editingCategory) {
      updateMutation.mutate({
        id: editingCategory.id,
        updates: formData,
      });
    } else {
      createMutation.mutate(formData);
    }
  };

  const groupedCategories = data?.categories.reduce(
    (acc, category) => {
      const type = category.type || "expense";
      if (!acc[type]) acc[type] = [];
      acc[type].push(category);
      return acc;
    },
    {} as Record<string, Category[]>
  );

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData((prev) => ({ ...prev, name: e.target.value }));
  };

  const handleTypeChange = (value: string) => {
    setFormData((prev) => ({ ...prev, type: value }));
  };

  const handleColorChange = (color: string) => {
    setFormData((prev) => ({ ...prev, color }));
  };

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const [activeId, setActiveId] = useState<string | null>(null);
  const [draggedCategory, setDraggedCategory] = useState<Category | null>(null);

  const handleDragStart = (event: any) => {
    const { active } = event;
    setActiveId(active.id);
    const category = data?.categories.find((c) => c.id === active.id);
    setDraggedCategory(category || null);
  };

  const handleDragEnd = (event: any) => {
    const { active, over } = event;
    setActiveId(null);
    setDraggedCategory(null);

    if (!over) {
      return;
    }

    // Check if dropped on a category type container (card)
    const targetType = CATEGORY_TYPES.find((type) => {
      // Check if dropped directly on the card container
      if (over.id === type.value) {
        return true;
      }
      // Check if dropped on a category in that type's list
      const categories = groupedCategories?.[type.value] || [];
      return categories.some((c) => c.id === over.id);
    });

    if (!targetType) {
      return;
    }

    const category = data?.categories.find((c) => c.id === active.id);
    if (category && category.type !== targetType.value) {
      updateTypeMutation.mutate({
        id: category.id,
        type: targetType.value,
      });
    }
  };

  const CategoryForm = () => (
    <div className="grid gap-4 py-4">
      <div className="grid gap-2">
        <Label htmlFor="name">Name</Label>
        <Input
          id="name"
          value={formData.name}
          onChange={handleNameChange}
          placeholder="Category name"
          data-testid="input-category-name"
          autoFocus
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="type">Type</Label>
        <Select
          value={formData.type}
          onValueChange={handleTypeChange}
        >
          <SelectTrigger data-testid="select-category-type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CATEGORY_TYPES.map((type) => (
              <SelectItem key={type.value} value={type.value}>
                {type.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-2">
        <Label>Color</Label>
        <div className="flex flex-wrap gap-2">
          {CATEGORY_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              onClick={() => handleColorChange(color)}
              className={`h-8 w-8 rounded-full transition-transform ${
                formData.color === color
                  ? "ring-2 ring-offset-2 ring-primary scale-110"
                  : ""
              }`}
              style={{ backgroundColor: color }}
              data-testid={`button-color-${color.slice(1)}`}
            />
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex-1 space-y-6 overflow-auto p-4 sm:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Categories</h1>
          <p className="text-muted-foreground">
            Manage how your transactions are organized
          </p>
        </div>
        <Dialog 
          open={isCreateOpen} 
          onOpenChange={(open) => {
            setIsCreateOpen(open);
            if (!open) {
              resetForm();
            }
          }}
        >
          <DialogTrigger asChild>
            <Button className="gap-2" data-testid="button-create-category">
              <Plus className="h-4 w-4" />
              Create Category
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Category</DialogTitle>
              <DialogDescription>
                Add a new category to organize your transactions.
              </DialogDescription>
            </DialogHeader>
            <CategoryForm />
            <DialogFooter>
              <Button 
                variant="outline" 
                onClick={() => {
                  setIsCreateOpen(false);
                  resetForm();
                }}
              >
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={!formData.name || createMutation.isPending}
                data-testid="button-save-category"
              >
                {createMutation.isPending ? "Creating..." : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="grid gap-6 md:grid-cols-2">
          {[...Array(4)].map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <div className="h-6 w-24 animate-pulse rounded bg-muted" />
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {[...Array(4)].map((_, j) => (
                    <div
                      key={j}
                      className="h-8 w-20 animate-pulse rounded-full bg-muted"
                    />
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : data?.categories && data.categories.length > 0 ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="grid gap-6 md:grid-cols-2">
            {CATEGORY_TYPES.map((type) => {
              const categories = groupedCategories?.[type.value] || [];
              return (
                <Card key={type.value} id={type.value} className="min-h-[200px]">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg">{type.label}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {categories.length > 0 ? (
                      <SortableContext
                        items={categories.map((c) => c.id)}
                        strategy={verticalListSortingStrategy}
                        id={type.value}
                      >
                        <div className="space-y-2">
                          {categories.map((category) => (
                            <SortableCategoryItem
                              key={category.id}
                              category={category}
                              onEdit={handleEdit}
                              onDelete={setDeletingCategory}
                            />
                          ))}
                        </div>
                      </SortableContext>
                    ) : (
                      <div
                        className="flex items-center justify-center min-h-[100px] border-2 border-dashed rounded-lg border-muted"
                        id={type.value}
                      >
                        <p className="text-sm text-muted-foreground">
                          Drop categories here
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
          <DragOverlay>
            {draggedCategory ? (
              <div className="rounded-lg p-2 bg-background border shadow-lg">
                <CategoryBadge category={draggedCategory} />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      ) : (
        <EmptyState
          icon={Tag}
          title="No categories yet"
          description="Create categories to organize your transactions."
          actionLabel="Create Category"
          onAction={() => setIsCreateOpen(true)}
        />
      )}

      <Dialog
        open={!!editingCategory}
        onOpenChange={(open) => {
          if (!open) {
            setEditingCategory(null);
            resetForm();
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Category</DialogTitle>
            <DialogDescription>
              Make changes to your category.
            </DialogDescription>
          </DialogHeader>
          <CategoryForm />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setEditingCategory(null);
                resetForm();
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={!formData.name || updateMutation.isPending}
              data-testid="button-update-category"
            >
              {updateMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!deletingCategory}
        onOpenChange={(open) => !open && setDeletingCategory(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Category</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deletingCategory?.name}"?
              Transactions using this category will be uncategorized.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                deletingCategory && deleteMutation.mutate(deletingCategory.id)
              }
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
