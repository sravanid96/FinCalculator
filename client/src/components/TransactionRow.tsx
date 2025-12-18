import { format } from "date-fns";
import { MoreHorizontal, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatCurrency } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import type { Transaction, Category, Account } from "@shared/schema";

interface TransactionRowProps {
  transaction: Transaction;
  category?: Category;
  account?: Account;
  onEdit?: (transaction: Transaction) => void;
  onCategoryChange?: (transaction: Transaction) => void;
  onDelete?: (transaction: Transaction) => void;
}

export function TransactionRow({
  transaction,
  category,
  account,
  onEdit,
  onCategoryChange,
  onDelete,
}: TransactionRowProps) {
  const amount = parseFloat(transaction.amount);
  const isIncome = transaction.isIncome || amount > 0;

  return (
    <div
      className="group flex items-center gap-4 border-b px-4 py-4 transition-colors last:border-b-0 hover-elevate"
      data-testid={`transaction-row-${transaction.id}`}
    >
      <div className="flex flex-1 flex-col gap-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium truncate" data-testid={`text-transaction-description-${transaction.id}`}>
            {transaction.description}
          </span>
          {transaction.isRecurring && (
            <RefreshCw className="h-3 w-3 text-muted-foreground flex-shrink-0" />
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>{format(new Date(transaction.date), "MMM d, yyyy")}</span>
          {account && (
            <>
              <span className="text-muted-foreground/50">•</span>
              <span className="truncate">{account.accountName}</span>
            </>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3">
        {category && (
          <Badge
            variant="secondary"
            className="hidden sm:flex"
            style={{ backgroundColor: `${category.color}20`, color: category.color }}
          >
            {category.name}
          </Badge>
        )}

        <span
          className={cn(
            "min-w-[100px] text-right font-semibold tabular-nums",
            isIncome ? "text-green-600 dark:text-green-400" : "text-foreground"
          )}
          data-testid={`text-transaction-amount-${transaction.id}`}
        >
          {isIncome ? "+" : "-"}{formatCurrency(Math.abs(amount))}
        </span>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="invisible group-hover:visible"
              data-testid={`button-transaction-menu-${transaction.id}`}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onEdit?.(transaction)}>
              Edit transaction
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onCategoryChange?.(transaction)}>
              Change category
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => onDelete?.(transaction)}
              className="text-destructive"
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

export function TransactionRowSkeleton() {
  return (
    <div className="flex items-center gap-4 border-b px-4 py-4 last:border-b-0">
      <div className="flex flex-1 flex-col gap-2">
        <div className="h-5 w-48 animate-pulse rounded bg-muted" />
        <div className="h-4 w-32 animate-pulse rounded bg-muted" />
      </div>
      <div className="h-6 w-20 animate-pulse rounded bg-muted" />
      <div className="h-5 w-24 animate-pulse rounded bg-muted" />
    </div>
  );
}
