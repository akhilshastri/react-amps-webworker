// Pure exponential-backoff delay computation (plan §3/M5, pulled forward
// into M2 per the connect path): 0.5s, 1s, 2s, 4s, 8s, then capped at 8s.
// `attempt` is 0-based (the delay BEFORE the (attempt+1)-th retry).
export function computeBackoffDelay(attempt: number, initialMs: number, maxMs: number): number {
  return Math.min(initialMs * 2 ** attempt, maxMs);
}
