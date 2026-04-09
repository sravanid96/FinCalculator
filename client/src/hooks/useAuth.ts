import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import type { User } from "@shared/schema";
import { getQueryFn } from "@/lib/queryClient";

export function useAuth() {
  const query = useQuery<User | null>({
    queryKey: ["/api/auth/user"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    retry: false,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });

  const { data: user, isLoading, error, isSuccess } = query;

  // Only clear token after a definitive 401 (query succeeds with null), not on network/parse errors.
  useEffect(() => {
    if (!isSuccess || user != null) return;
    if (typeof window === "undefined") return;
    if (localStorage.getItem("auth_token")) {
      localStorage.removeItem("auth_token");
    }
  }, [isSuccess, user]);

  return {
    user: user || undefined,
    isLoading,
    isAuthenticated: !!user,
    error,
  };
}
