/** Drizzle / Node often wrap pg errors; `code` lives on `.cause` chains. */
export function extractPgMeta(err: unknown): { code?: string; message: string } {
  let message = err instanceof Error ? err.message : String(err);
  let e: unknown = err;
  for (let depth = 0; depth < 10 && e != null; depth++) {
    const o = e as Record<string, unknown>;
    if (typeof o.code === "string" && o.code.length > 0) {
      return { code: o.code, message };
    }
    const next = o.cause;
    if (next instanceof Error && next.message) {
      message = next.message;
    }
    e = next;
  }
  return { code: undefined, message };
}
