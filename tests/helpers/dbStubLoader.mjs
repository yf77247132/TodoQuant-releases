/**
 * Node loader hook：把含副作用（DB 初始化 / WebSocket 连接）的服务模块
 * 重定向到无副作用替身（见 dbStub.mjs / wsStub.mjs）。
 * 仅在纯模块回归测试中通过 --import 使用，不影响应用运行时。
 */
export async function resolve(specifier, context, next) {
  if (specifier.endsWith('dbService.ts') || specifier.endsWith('dbService.js')) {
    return { url: new URL('./dbStub.mjs', import.meta.url).href, shortCircuit: true };
  }
  if (specifier.endsWith('wsManager.ts') || specifier.endsWith('wsManager.js')) {
    return { url: new URL('./wsStub.mjs', import.meta.url).href, shortCircuit: true };
  }
  return next(specifier, context);
}
