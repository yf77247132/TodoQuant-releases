/**
 * 测试专用 wsManager 替身：真实模块在导入/实例化时会建立 OKX WebSocket 连接，
 * 纯模块回归测试必须完全离线，loader hook 将 wsManager.ts 重定向到本文件。
 */

/** 万能空操作实例：测试路径不会真正调用 WS 方法，兜底防 undefined 报错 */
const noopInstance = new Proxy({}, {
  get(_t, prop) {
    if (prop === 'then') return undefined;
    return () => undefined;
  },
});

export class OKXWebSocketManager {
  static getInstance() {
    return noopInstance;
  }
  constructor() {}
}

export const OKX_WS_ERROR_MAP = {};
