import { useState, useCallback, useRef, useEffect } from "react";
import { Search, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface SearchResult {
  symbol: string;
  name: string;
}

interface TickerSearchProps {
  onSelect: (ticker: string) => void;
}

export function TickerSearch({ onSelect }: TickerSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<NodeJS.Timeout>();

  const searchTickers = useCallback(async (searchQuery: string) => {
    if (!searchQuery || searchQuery.length < 1) {
      setResults([]);
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch(`/api/options/search?q=${encodeURIComponent(searchQuery)}`);
      if (res.ok) {
        const data = await res.json();
        setResults(data);
      }
    } catch (error) {
      console.error("Search failed:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value.toUpperCase();
      setQuery(value);
      setSelectedIndex(-1);

      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }

      debounceRef.current = setTimeout(() => {
        searchTickers(value);
      }, 300);
    },
    [searchTickers]
  );

  const handleSelect = useCallback(
    (ticker: string) => {
      setQuery(ticker);
      setShowResults(false);
      setResults([]);
      onSelect(ticker);
    },
    [onSelect]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!showResults || results.length === 0) {
        if (e.key === "Enter" && query) {
          handleSelect(query);
        }
        return;
      }

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((prev) => Math.max(prev - 1, -1));
          break;
        case "Enter":
          e.preventDefault();
          if (selectedIndex >= 0) {
            handleSelect(results[selectedIndex].symbol);
          } else if (query) {
            handleSelect(query);
          }
          break;
        case "Escape":
          setShowResults(false);
          break;
      }
    },
    [showResults, results, selectedIndex, query, handleSelect]
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (query) {
        handleSelect(query);
      }
    },
    [query, handleSelect]
  );

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        resultsRef.current &&
        !resultsRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setShowResults(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (results.length > 0) {
      setShowResults(true);
    }
  }, [results]);

  return (
    <form onSubmit={handleSubmit} className="relative">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={inputRef}
            type="text"
            placeholder="Search ticker (e.g., AAPL, MSFT, TSLA)"
            value={query}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onFocus={() => results.length > 0 && setShowResults(true)}
            className="pl-10 text-lg"
            autoComplete="off"
          />
          {isLoading && (
            <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
          )}
        </div>
        <Button type="submit" size="lg">
          Analyze
        </Button>
      </div>

      {/* Search Results Dropdown */}
      {showResults && results.length > 0 && (
        <div
          ref={resultsRef}
          className="absolute top-full left-0 right-0 z-50 mt-1 max-h-60 overflow-auto rounded-md border bg-popover shadow-lg"
        >
          {results.map((result, index) => (
            <button
              key={result.symbol}
              type="button"
              onClick={() => handleSelect(result.symbol)}
              className={cn(
                "flex w-full items-center justify-between px-4 py-2 text-left hover:bg-accent",
                selectedIndex === index && "bg-accent"
              )}
            >
              <span className="font-medium">{result.symbol}</span>
              <span className="text-sm text-muted-foreground truncate ml-2 max-w-[200px]">
                {result.name}
              </span>
            </button>
          ))}
        </div>
      )}
    </form>
  );
}
