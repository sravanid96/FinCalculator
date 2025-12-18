import { Badge } from "@/components/ui/badge";
import type { Category } from "@shared/schema";
import {
  Home,
  Zap,
  ShoppingCart,
  Utensils,
  Car,
  Plane,
  RefreshCw,
  Shield,
  Heart,
  ShoppingBag,
  Film,
  Percent,
  MoreHorizontal,
  Briefcase,
  Laptop,
  TrendingUp,
  DollarSign,
  PiggyBank,
  Umbrella,
  BarChart3,
  Clock,
  Tag,
} from "lucide-react";
import { cn } from "@/lib/utils";

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  Home,
  Zap,
  ShoppingCart,
  Utensils,
  Car,
  Plane,
  RefreshCw,
  Shield,
  Heart,
  ShoppingBag,
  Film,
  Percent,
  MoreHorizontal,
  Briefcase,
  Laptop,
  TrendingUp,
  DollarSign,
  PiggyBank,
  Umbrella,
  BarChart3,
  Clock,
};

interface CategoryBadgeProps {
  category: Category;
  size?: "sm" | "default" | "lg";
  showIcon?: boolean;
  className?: string;
}

export function CategoryBadge({
  category,
  size = "default",
  showIcon = true,
  className,
}: CategoryBadgeProps) {
  const Icon = category.icon ? iconMap[category.icon] || Tag : Tag;

  const sizeClasses = {
    sm: "text-xs px-2 py-0.5",
    default: "text-sm px-3 py-1",
    lg: "text-base px-4 py-1.5",
  };

  return (
    <Badge
      variant="secondary"
      className={cn(
        "inline-flex items-center gap-1.5 font-medium",
        sizeClasses[size],
        className
      )}
      style={{
        backgroundColor: `${category.color}20`,
        color: category.color,
        borderColor: `${category.color}40`,
      }}
    >
      {showIcon && <Icon className="h-3.5 w-3.5" />}
      <span>{category.name}</span>
    </Badge>
  );
}
