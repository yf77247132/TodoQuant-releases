
export function formatApiError(result: any, dataIdx: number = 0): string {
  if (!result) return "未知错误";
  const code = result.code;
  const msg = result.msg;
  const data = result.data?.[dataIdx] || {};
  const sCode = data.sCode;
  const sMsg = data.sMsg;

  const parts: string[] = [];

  if (code && code !== "0") {
    parts.push(`"code":"${code}"`);
    if (sCode && sCode !== "0" && sCode !== code) {
      parts.push(`"sCode":"${sCode}"`);
    }
  } else if (sCode && sCode !== "0") {
    parts.push(`"sCode":"${sCode}"`);
  }

  if (sMsg && sMsg !== "" && sMsg !== "OK") {
    parts.push(`"sMsg":"${sMsg}"`);
    if (msg && msg !== "" && msg !== "OK" && msg !== sMsg) {
      parts.push(`"msg":"${msg}"`);
    }
  } else if (msg && msg !== "" && msg !== "OK") {
    parts.push(`"msg":"${msg}"`);
  }

  return parts.length > 0 ? parts.join(", ") : (msg || "未知错误");
}
