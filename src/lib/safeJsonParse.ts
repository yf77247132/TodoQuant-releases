export interface SafeJsonParseMeta {
  context: string;
  rawPreview: string;
}

export interface SafeJsonParseOptions {
  context?: string;
  reporter?: (error: Error, meta: SafeJsonParseMeta) => void;
}

export function safeJsonParse<T>(
  raw: unknown,
  fallback: T,
  options?: SafeJsonParseOptions
): T {
  const context = options?.context || 'safeJsonParse';
  if (raw === null || raw === undefined || raw === '') return fallback;

  const text = typeof raw === 'string' ? raw : String(raw);
  try {
    return JSON.parse(text) as T;
  } catch (e: unknown) {
    const error = e instanceof Error ? e : new Error(String(e));
    options?.reporter?.(error, { context, rawPreview: text.slice(0, 200) });
    return fallback;
  }
}
