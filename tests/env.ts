/**
 * 测试环境隔离引导模块
 *
 * ## 为什么需要它（2026-09-14 修复的真实缺陷）
 * `src/services/dbService.ts` 在**模块作用域**就执行 `initDatabase()` + `scheduleAutoBackup()`，
 * 而 `src/lib/getAppPath.ts` 在「缺少 ELECTRON_USER_DATA_PATH 且非 Electron 环境」时
 * **回落 `process.cwd()`** —— 这意味着直接在项目根跑 `npm run test` / `npm run ci:gate:full`
 * 会以读写方式打开**真实的 trading.db**（建表、WAL、备份调度），污染真实交易数据。
 *
 * 此前只有手动传 `ELECTRON_USER_DATA_PATH=<临时目录>` 才安全（例如 CI 脚本里），
 * 全仓仅 1 个测试文件自设该变量，所以「闸口脚本 = 动真实库」是长期存在的隐患。
 *
 * ## 用法（必须保证顺序）
 * 通过 `--import` 在 `./tests/setup.ts` **之前**加载：
 * ```
 * node --import tsx --import ./tests/env.ts --import ./tests/setup.ts --test ...
 * ```
 * `--import` 按声明顺序求值，因此本模块的赋值先于 `setup.ts` 对 dbService 的静态导入，
 * 使 dbService 模块作用域读到的 `ELECTRON_USER_DATA_PATH` 已是隔离目录。
 *
 * ## 不覆盖显式传入的值
 * 若调用方已设置 `ELECTRON_USER_DATA_PATH`（手工调试、CI 自选目录），本模块不干预。
 *
 * @module tests/env
 */

import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

if (!process.env.ELECTRON_USER_DATA_PATH) {
  const isolatedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'okts-testdata-'));
  process.env.ELECTRON_USER_DATA_PATH = isolatedDir;

  // 尽力清理：测试结束（tests/setup.ts 的 after 钩子已关闭 DB 句柄）后删除隔离目录。
  // 清理失败不影响测试结论（临时目录由操作系统兜底回收），因此静默忽略。
  process.on('exit', () => {
    try {
      fs.rmSync(isolatedDir, { recursive: true, force: true });
    } catch {
      /* best-effort：句柄未释放等情况直接忽略 */
    }
  });
}
