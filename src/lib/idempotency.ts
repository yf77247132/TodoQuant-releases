
const MAX_KEY_LEN = 32;

function sanitizePart(value: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12) || "x";
  if (/^[a-zA-Z]/.test(cleaned)) return cleaned;
  return `a${cleaned}`.slice(0, 12);
}

function shortRandom(): string {
  return Math.random().toString(36).slice(2, 8);
}

export function createRequestIdempotencyKey(prefix: string, scope?: string): string {
  const p = sanitizePart(prefix);
  const s = scope ? sanitizePart(scope) : "req";
  const ts = Date.now().toString(36);
  return `${p}${s}${ts}${shortRandom()}`.slice(0, MAX_KEY_LEN);
}

export function createChildIdempotencyKey(base: string, index: number): string {
  const normalizedBase = (base || "").replace(/[^a-zA-Z0-9]/g, "") || "x";
  const suffix = Math.max(0, index).toString(36).replace(/[^a-zA-Z0-9]/g, "") || "0";
  const maxBaseLen = Math.max(1, MAX_KEY_LEN - suffix.length - 1);
  return `${normalizedBase.slice(0, maxBaseLen)}x${suffix}`.slice(0, MAX_KEY_LEN);
}

export function createBatchSignature(accountIdx: number, isAlgo: boolean, ids: string[]): string {
  const stableIds = [...ids].sort().join(",");
  return `${accountIdx}:${isAlgo ? "a" : "n"}:${stableIds}`;
}
