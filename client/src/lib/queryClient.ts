import { QueryClient, QueryFunction } from "@tanstack/react-query";

/** True when the UI is clearly running against the local unified dev server (same machine). */
function isLoopbackPage(): boolean {
  if (typeof window === "undefined") return false;
  const h = window.location.hostname;
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "";
}

function apiBaseOverride(): string | undefined {
  const raw = import.meta.env.VITE_API_BASE_URL as string | undefined;
  if (!raw?.trim()) return undefined;
  // If .env still has production API URL but you run `npm run dev` on localhost, cross-origin
  // login/watchlist fails (CORS / "Load failed"). Loopback always uses same-origin API.
  if (isLoopbackPage()) return undefined;
  return raw.replace(/\/$/, "");
}

/**
 * Turn `/api/...` into an absolute URL when safe.
 * - `window.location.origin` is the string "null" on file:// and some embedded contexts; concatenating
 *   produced `null/api/...` → Safari "Load failed".
 * - Only prefix for real http(s) pages with a host.
 * - Optional `VITE_API_BASE_URL` when UI and API are on different origins (set at build time, no trailing slash).
 */
export function resolveApiUrl(url: string): string {
  if (typeof window === "undefined") return url;
  if (/^https?:\/\//i.test(url)) return url;
  if (!url.startsWith("/")) return url;

  const override = apiBaseOverride();
  if (override) return `${override}${url}`;

  const { protocol, host } = window.location;
  if ((protocol === "http:" || protocol === "https:") && host) {
    return `${protocol}//${host}${url}`;
  }

  return url;
}

async function fetchResolved(url: string, init?: RequestInit): Promise<Response> {
  const resolved = resolveApiUrl(url);
  try {
    // Avoid browser HTTP cache returning 304 with an empty body — `res.json()` then throws and auth breaks.
    return await fetch(resolved, { ...init, cache: init?.cache ?? "no-store" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `${msg} (${resolved}). Use an http(s) URL for the app, or set VITE_API_BASE_URL if the API is on another host.`,
    );
  }
}

/** Same as `fetch` but uses {@link resolveApiUrl} and clearer errors when the request never reaches the server. */
export async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  return fetchResolved(input, init);
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    try {
      const j = JSON.parse(text) as {
        message?: string;
        issues?: { path?: (string | number)[]; message?: string }[];
      };
      if (typeof j?.message === "string") {
        let msg = j.message;
        if (Array.isArray(j.issues) && j.issues.length) {
          const detail = j.issues
            .map((i) => {
              const p = i.path?.length ? `${i.path.join(".")}: ` : "";
              return `${p}${i.message ?? ""}`.trim();
            })
            .filter(Boolean)
            .join("; ");
          if (detail) msg = `${msg} (${detail})`;
        }
        throw new Error(msg);
      }
    } catch (e) {
      if (e instanceof SyntaxError) {
        // Body wasn't JSON; fall through to generic error below.
      } else if (e instanceof Error) {
        throw e;
      }
    }
    throw new Error(text.trim() ? `${res.status}: ${text}` : `${res.status} ${res.statusText}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const token = localStorage.getItem("auth_token");
  const headers: Record<string, string> = data ? { "Content-Type": "application/json" } : {};
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetchResolved(url, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
    cache: "no-store",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const token = localStorage.getItem("auth_token");
    const headers: Record<string, string> = {};
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    // Handle query parameters - if queryKey has more than one element and the second is an object, treat it as query params
    let url: string;
    if (queryKey.length > 1 && typeof queryKey[1] === "object" && queryKey[1] !== null) {
      const baseUrl = queryKey[0] as string;
      const params = new URLSearchParams();
      Object.entries(queryKey[1] as Record<string, string>).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          params.append(key, String(value));
        }
      });
      url = `${baseUrl}${params.toString() ? `?${params.toString()}` : ""}`;
    } else {
      // For simple query keys, join with "/" for path segments
      url = queryKey.join("/") as string;
    }

    const res = await fetchResolved(url, {
      credentials: "include",
      headers,
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    if (res.status === 304) {
      throw new Error(
        "Received 304 from API with no body (browser cache). This should not happen with cache: no-store.",
      );
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: true,
      staleTime: 0, // Always refetch to check auth status
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
