import zhCN from "../i18n/locales/zh-CN.json";

export function t(key: string): string {
  if (!key) return "";
  const parts = key.split(".");
  let current: Record<string, unknown> = zhCN as Record<string, unknown>;
  for (const part of parts) {
    if (current && typeof current === "object" && part in current) {
      current = current[part] as Record<string, unknown>;
    } else {
      return key;
    }
  }
  return typeof current === "string" ? current : key;
}
