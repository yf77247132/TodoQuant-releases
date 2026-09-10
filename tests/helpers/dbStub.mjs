/**
 * 测试专用 dbService 替身：better-sqlite3 为 Electron 编译，系统 Node 加载不了，
 * 且真实 dbService 在模块作用域会执行 initDatabase + 备份（会碰 trading.db）。
 * 纯模块回归测试通过 loader hook 把 dbService 重定向到本文件，保证零 DB 副作用。
 */

/** 任意方法调用返回 null（getConfig 等查询语义的合法空值） */
const safeFn = () => null;

const dbServiceStub = new Proxy({}, {
  get(_target, prop) {
    // 防止被 await 当作 thenable
    if (prop === 'then') return undefined;
    return safeFn;
  },
});

export const dbService = dbServiceStub;
export const ready = Promise.resolve();
export const initDatabase = () => {};
export const createTables = () => {};
export const isReady = () => true;
export const saveDb = () => {};
export const backupTo = async () => {};
export const closeDb = () => {};
export const reloadDb = () => {};
export const scheduleAutoBackup = () => {};
