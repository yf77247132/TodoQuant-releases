import express, { type Application, type Request, type Response } from 'express';
import { ErrorMonitor, ErrorLevel, ErrorCategory } from '../../services/errorMonitor.ts';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { backupTo, closeDb, reloadDb } from '../../services/dbService.ts';
import { tunnelManager } from '../../services/tunnelManager.ts';
import { evaluateFormula, isFormula, formatPreview } from '../../lib/priceFormula.ts';
import { fetchMarketPrice, fetchFundingRates } from '../../lib/marketPrice.ts';
import { DiyEngine } from '../../engine/diy/DiyEngine.ts';
import { AmendOrderAction } from '../../blocks/actions/AmendOrderAction.ts';
import { AccountMonitor } from '../../services/AccountMonitor.ts';
import { SymbolUtils } from '../../lib/symbolUtils.ts';
import { asyncHandler, findAccountById, sendError, toError } from './shared.ts';
import type { TradeOrder } from '../../types/trade.ts';
import type { OKXPosition } from '../../types/okx.ts';
import { isPendingNewState } from '../../lib/orderStates.ts';

interface ExtendedOrder extends TradeOrder {
  type?: string;
  _execType?: string;
  orderType?: string;
  trailingDelta?: string | number;
  callbackRate?: string | number;
  priceRate?: string | number;
  contingencyType?: string;
}

export function registerSystemRoutes(app: Application): void {
  registerVersionSubRoutes(app);
  registerDatabaseSubRoutes(app);
  registerEmailSubRoutes(app);
  registerDiagnosticsSubRoutes(app);
  registerRestartSubRoutes(app);
  registerTunnelSubRoutes(app);
  registerFormulaSubRoutes(app);
  registerPreviewSubRoutes(app);
  registerFundingRateSubRoutes(app);
  registerLocaleSubRoutes(app);
  registerTelegramSubRoutes(app);
}

function registerTelegramSubRoutes(app: Application): void {
  app.post("/api/telegram/bind", asyncHandler(async (_req, res) => {
    const { TelegramService } = await import('../../services/telegramService.ts');
    const result = TelegramService.startBinding();
    if (result.ok) res.json({ ok: true, code: result.code, deepLink: result.deepLink, tgLink: result.tgLink });
    else res.status(400).json({ ok: false, error: result.error });
  }));

  app.post("/api/telegram/unbind", asyncHandler(async (_req, res) => {
    const { TelegramService } = await import('../../services/telegramService.ts');
    TelegramService.unbind();
    res.json({ ok: true });
  }));

  app.post("/api/telegram/test", asyncHandler(async (_req, res) => {
    const { TelegramService } = await import('../../services/telegramService.ts');
    const result = await TelegramService.sendTest();
    if (result.ok) res.json({ ok: true });
    else res.status(400).json({ ok: false, error: result.error });
  }));

  app.get("/api/telegram/status", asyncHandler(async (_req, res) => {
    const { TelegramService } = await import('../../services/telegramService.ts');
    res.json({ ok: true, ...TelegramService.getStatus() });
  }));
}

function registerVersionSubRoutes(app: Application): void {
  app.get("/api/system/app-version", (_req, res) => {
    try {
      const pkgPath = path.join(process.cwd(), 'package.json');
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      res.json({ version: pkg.version || '0.0.0' });
    } catch {
      res.json({ version: '0.0.0' });
    }
  });
}

function registerDatabaseSubRoutes(app: Application): void {
  const BACKUP_DIR = path.join(process.cwd(), "backups");
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR);

  app.post("/api/db/backup", asyncHandler(async (_req, res) => {
    const backupPath = path.join(BACKUP_DIR, `trading.db.${Date.now()}`);
    await backupTo(backupPath);
    res.json({ ok: true, file: path.basename(backupPath) });
  }));

  app.get("/api/db/backups", (_req, res) => {
    try {
      const files = fs.readdirSync(BACKUP_DIR);
      res.json({ ok: true, files });
    } catch (_e: unknown) {
      res.status(500).json({ ok: false, error: "获取备份列表失败" });
    }
  });

  app.post("/api/db/restore", express.json(), (req, res) => {
    const { filename } = req.body;

    if (!filename || typeof filename !== 'string') {
      return res.status(400).json({ error: "文件名无效" });
    }

    const sanitizedFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '');
    if (sanitizedFilename !== filename) {
      return res.status(400).json({ error: "文件名包含非法字符" });
    }

    const backupPath = path.join(BACKUP_DIR, sanitizedFilename);
    const normalizedPath = path.normalize(backupPath);

    if (!normalizedPath.startsWith(path.resolve(BACKUP_DIR))) {
      return res.status(403).json({ error: "拒绝访问：文件路径非法" });
    }

    if (!fs.existsSync(backupPath)) {
      return res.status(404).json({ error: "备份文件不存在" });
    }

    try {
      closeDb();
      for (const suffix of ['-shm', '-wal']) {
        try { fs.unlinkSync('trading.db' + suffix); } catch {  }
      }
      fs.copyFileSync(backupPath, "trading.db");
      reloadDb();
      res.json({ ok: true });
    } catch (_e: unknown) {
      res.status(500).json({ ok: false, error: "恢复失败" });
    }
  });
}

function registerEmailSubRoutes(app: Application): void {
  app.post("/api/email/test", asyncHandler(async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ ok: false, error: '缺少测试邮箱地址' });

    const { EmailService } = await import('../../services/emailService.ts');
    await EmailService.sendNotification(
      email,
      'TodoQuant 邮件服务测试',
      `这是一封来自 TodoQuant 的测试邮件。\n时间: ${new Date().toLocaleString()}\n如果你收到了这封邮件，说明 Resend SMTP 配置已生效。`
    );
    res.json({ ok: true });
  }));
}

function registerDiagnosticsSubRoutes(app: Application): void {
  app.get("/api/system/ip", async (_req, res) => {
    try {
      const response = await fetch('https://api.ipify.org?format=json');
      const data = await response.json() as { ip: string };
      res.json({ ok: true, ip: data.ip });
    } catch (_e: unknown) {
      try {
        const response2 = await fetch('https://ifconfig.me/ip');
        const ip = await response2.text();
        res.json({ ok: true, ip: ip.trim() });
      } catch (e2: unknown) {
        sendError(res, e2);
      }
    }
  });
}

function registerRestartSubRoutes(app: Application): void {
  app.post("/api/system/restart", (_req, res) => {
    res.json({ ok: true });
    setTimeout(() => {
      const isDev = process.argv.some(arg => arg.includes('tsx') || arg.includes('server.ts'));
      
      if (isDev) {
        process.exit(0);
      } else {
        const currentScript = process.argv[1];
        if (currentScript) {
          const child = spawn(process.argv[0], [currentScript], {
            detached: true,
            stdio: 'inherit',
            cwd: process.cwd()
          });
          child.unref();
        }
        process.exit(0);
      }
    }, 500);
  });
}

function registerTunnelSubRoutes(app: Application): void {
  app.get("/api/tunnel/status", (_req, res) => {
    const { status, url } = tunnelManager.getStatus();
    res.json({ ok: true, status, url });
  });

  app.post("/api/tunnel/start", asyncHandler(async (req, res) => {
    const { port } = req.body;
    const localPort = typeof port === 'number' ? port : 3000;
    const url = await tunnelManager.start(localPort);
    res.json({ ok: true, status: 'running', url });
  }));

  app.post("/api/tunnel/stop", (_req, res) => {
    tunnelManager.stop();
    res.json({ ok: true, status: 'stopped' });
  });
}

function registerFormulaSubRoutes(app: Application): void {
  app.post("/api/evaluate-formula", express.json(), async (req, res) => {
    const { formula, instId, orderPrice, n, positionSize } = req.body || {};

    if (!formula || typeof formula !== 'string') {
      return res.status(400).json({ ok: false, errorCode: 'MISSING_FORMULA' });
    }
    if (!isFormula(formula)) {
      return res.json({ ok: true, isFormula: false });
    }

    const variables: Record<string, number> = {};

    const fml = formula.slice(1);
    const needsMarketPrice = /[^a-zA-Z](m|M)[^a-zA-Z]/.test(` ${fml} `) || /^(m|M)$/.test(fml.trim());
    if (needsMarketPrice) {
      if (!instId || typeof instId !== 'string') {
        return res.status(400).json({ ok: false, errorCode: 'MISSING_INST_ID' });
      }
      const marketPrice = await fetchMarketPrice(instId);
      if (marketPrice === null) {
        return res.json({ ok: false, errorCode: 'MARKET_PRICE_UNAVAILABLE' });
      }
      variables.m = marketPrice;
      variables.M = marketPrice;
    }

    const needsOrderPrice = /[^a-zA-Z](o|O)[^a-zA-Z]/.test(` ${fml} `) || /^(o|O)$/.test(fml.trim());
    if (needsOrderPrice) {
      if (orderPrice !== undefined && orderPrice !== null) {
        variables.o = orderPrice;
        variables.O = orderPrice;
      } else {
        return res.json({ ok: false, errorCode: 'MISSING_ORDER_PRICE' });
      }
    }

    const needsN = /[^a-zA-Z](n|N)[^a-zA-Z]/.test(` ${fml} `) || /^(n|N)$/.test(fml.trim());
    if (needsN) {
      if (n !== undefined && n !== null) {
        variables.n = n;
        variables.N = n;
      } else {
        const previews: string[] = [];
        for (let i = 0; i <= 2; i++) {
          const vars = { ...variables, n: i, N: i };
          const result = evaluateFormula(formula, vars);
          if (result.errorCode) {
            return res.json({ ok: false, errorCode: result.errorCode, error: result.error });
          }
          const rounded = Math.round((result.result || 0) * 1e8) / 1e8;
          previews.push(`n=${i}→${rounded}`);
        }
        return res.json({
          ok: true,
          preview: previews.join(', '),
          vars: Object.keys(variables),
        });
      }
    }

    const needsS = /[^a-zA-Z](s|S)[^a-zA-Z]/.test(` ${fml} `) || /^(s|S)$/.test(fml.trim());
    if (needsS) {
      if (positionSize !== undefined && positionSize !== null) {
        variables.s = positionSize;
        variables.S = positionSize;
      } else {
        return res.json({ ok: false, errorCode: 'MISSING_POSITION' });
      }
    }

    const result = evaluateFormula(formula, variables);
    const preview = formatPreview(result, variables);

    res.json({
      ok: !result.errorCode,
      result: result.result,
      preview,
      errorCode: result.errorCode || undefined,
      error: result.error || undefined,
      vars: Object.keys(variables),
    });
  });
}

function registerPreviewSubRoutes(app: Application): void {
  app.post("/api/preview-orders", express.json(), async (req, res) => {
    const {
      instId, orderType, side, orderDirection,
      firstOrderPrice, orderInterval, orderCount, contractSize,
      takeProfitMargin, stopLossMargin,
      firstTpPrice, firstSlPrice, activePx,
      tpSlType, callbackRatioSpread, chaseVal,
      positionSize,
    } = req.body || {};

    const count = parseInt(orderCount) || 5;
    if (count <= 0) return res.json({ ok: true, orders: [] });

    const direction = orderDirection || 'up';
    const isBuy = side === 'buy';
    const isRegular = ['market', 'limit', 'post_only', 'fok', 'ioc'].includes(orderType);
    const isTrig = orderType === 'trigger';
    const isCond = orderType === 'conditional';
    const isOco = orderType === 'oco';
    const isChs = orderType === 'chase';
    const isMos = orderType === 'move_order_stop';
    const isMoveStop = tpSlType === 'move_stop';

    let marketPrice: number | null = null;
    const allFormulas = [firstOrderPrice, orderInterval, contractSize, firstTpPrice, firstSlPrice, activePx];
    const anyNeedsM = orderType === 'market' || allFormulas.some(v => typeof v === 'string' && isFormula(v) && /\bm\b/i.test(v.slice(1)));
    if (anyNeedsM && instId) {
      marketPrice = await fetchMarketPrice(instId);
    }

    const resolveVal = async (raw: string, extraVars?: Record<string, number>): Promise<number | null> => {
      if (!raw || raw === '-1') return null;
      if (!isFormula(raw)) {
        const num = parseFloat(raw);
        return Number.isFinite(num) ? num : null;
      }
      const vars: Record<string, number> = { m: marketPrice ?? 0, M: marketPrice ?? 0, s: positionSize ?? 0, S: positionSize ?? 0, ...extraVars };
      const result = evaluateFormula(raw, vars);
      if (result.errorCode) return null;
      return Math.round((result.result ?? 0) * 1e8) / 1e8;
    };

    const parseMargin = (raw: string) => {
      const trimmed = (raw || '-1').trim();
      if (trimmed === '-1' || trimmed === '') return { value: -1, isPercent: false };
      const isPct = trimmed.endsWith('%');
      const num = parseFloat(isPct ? trimmed.slice(0, -1) : trimmed);
      return { value: Number.isFinite(num) ? num : -1, isPercent: isPct };
    };

    const calcTpSl = (base: number, margin: number, isPercent: boolean, isTp: boolean) => {
      if (isPercent) {
        const factor = margin / 100;
        return isTp
          ? (isBuy ? base * (1 + factor) : base * (1 - factor))
          : (isBuy ? base - margin : base + margin);
      }
      return isTp
        ? (isBuy ? base + margin : base - margin)
        : (isBuy ? base - margin : base + margin);
    };

    const rawCallback = callbackRatioSpread || '1%';
    const callbackIsPercent = String(rawCallback).endsWith('%');
    const callbackRatioVal = callbackIsPercent ? parseFloat(String(rawCallback).replace('%', '')) / 100 : -1;
    const callbackSpreadVal = callbackIsPercent ? -1 : parseFloat(String(rawCallback));

    const tpM = parseMargin(takeProfitMargin);
    const slM = parseMargin(stopLossMargin);

    const isIntervalFormula = isFormula(orderInterval);
    const isIntervalPercent = !isIntervalFormula && String(orderInterval).trim().endsWith('%');
    let baseInterval = 0;
    let intervalPercent = 0;
    if (!isIntervalFormula) {
      if (isIntervalPercent) {
        intervalPercent = parseFloat(String(orderInterval).replace('%', '')) / 100;
      } else {
        baseInterval = parseFloat(orderInterval) || 0;
      }
    }

    const firstOrderPriceNeedsN = isFormula(firstOrderPrice) && /\bn\b/i.test(firstOrderPrice.slice(1));
    let baseFirstPrice = 0;
    if (!firstOrderPriceNeedsN) {
      baseFirstPrice = (await resolveVal(firstOrderPrice)) ?? 0;
    }

    const activePxNeedsO = isFormula(activePx) && /\bo\b/i.test(activePx.slice(1));
    const activePxNeedsN = isFormula(activePx) && /\bn\b/i.test(activePx.slice(1));
    let baseActivePx: number | null = null;
    if (!activePxNeedsO && !activePxNeedsN) {
      baseActivePx = await resolveVal(activePx);
    }

    const baseTpPrice = (isCond || isOco) ? (await resolveVal(firstTpPrice)) ?? -1 : -1;
    const baseSlPrice = isOco ? (await resolveVal(firstSlPrice)) ?? -1 : -1;

    const orders: Array<Record<string, number | string | null>> = [];
    let accumulatedOffset = 0;

    for (let i = 0; i < count; i++) {
      const n = i;
      const order: Record<string, number | string | null> = { num: i + 1 };

      let curFirstPrice = baseFirstPrice;
      if (firstOrderPriceNeedsN) {
        curFirstPrice = (await resolveVal(firstOrderPrice, { n, N: n })) ?? 0;
      }

      let priceOffset = 0;
      if (isIntervalFormula) {
        if (i > 0) {
          const intervalN = i - 1;
          const vars: Record<string, number> = { m: marketPrice ?? 0, M: marketPrice ?? 0, s: positionSize ?? 0, S: positionSize ?? 0, n: intervalN, N: intervalN };
          const result = evaluateFormula(orderInterval, vars);
          if (!result.errorCode && result.result != null) {
            accumulatedOffset += result.result;
            priceOffset = direction === 'up' ? accumulatedOffset : -accumulatedOffset;
          }
        }
      } else if (isIntervalPercent) {
        const pctInterval = curFirstPrice * intervalPercent;
        priceOffset = direction === 'up' ? i * pctInterval : -i * pctInterval;
      } else {
        priceOffset = direction === 'up' ? i * baseInterval : -i * baseInterval;
      }

      let size: number | string | null = null;
      if (isFormula(contractSize)) {
        const triggerPx = curFirstPrice + priceOffset;
        const vars: Record<string, number> = { m: marketPrice ?? 0, M: marketPrice ?? 0, s: positionSize ?? 0, S: positionSize ?? 0, n, N: n, o: triggerPx, O: triggerPx };
        const result = evaluateFormula(contractSize, vars);
        size = result.errorCode ? null : Math.round((result.result ?? 0) * 1e8) / 1e8;
      } else {
        size = parseFloat(contractSize) || null;
      }
      order.size = size;

      if (isRegular || isTrig) {
        const px = parseFloat((curFirstPrice + (orderType === 'market' ? 0 : priceOffset)).toFixed(8));
        if (orderType === 'market') {
          order.price = marketPrice ?? null;
        } else {
          order.price = px;
        }
        if (isMoveStop || isMos) {
          let curActive: number | null = null;
          if (activePxNeedsO || activePxNeedsN) {
            curActive = (await resolveVal(activePx, { o: px, n, N: n })) ?? null;
          } else if (baseActivePx !== null && baseActivePx > 0) {
            curActive = parseFloat((baseActivePx + priceOffset).toFixed(8));
          }
          order.activePx = curActive;
          order.callbackRatio = callbackRatioVal > 0 ? callbackRatioVal : null;
          order.callbackSpread = callbackSpreadVal > 0 ? callbackSpreadVal : null;
        }
        if (!isMoveStop && !isMos) {
          if (tpM.value !== -1 && px > 0) {
            order.tpPrice = parseFloat(calcTpSl(px, tpM.value, tpM.isPercent, true).toFixed(8));
          }
          if (slM.value !== -1 && px > 0) {
            order.slPrice = parseFloat(calcTpSl(px, slM.value, slM.isPercent, false).toFixed(8));
          }
        } else if (slM.value !== -1 && px > 0) {
          order.slPrice = parseFloat(calcTpSl(px, slM.value, slM.isPercent, false).toFixed(8));
        }
      } else if (isCond || isOco) {
        const tpPx = baseTpPrice !== -1 ? parseFloat((baseTpPrice + priceOffset).toFixed(8)) : null;
        const slPx = baseSlPrice !== -1 ? parseFloat((baseSlPrice + priceOffset).toFixed(8)) : null;
        order.tpPrice = tpPx;
        order.slPrice = slPx;
      } else if (isChs) {
        const chaseBase = parseFloat(chaseVal) || 0;
        order.chaseVal = parseFloat((chaseBase + Math.abs(priceOffset)).toFixed(8));
      } else if (isMos) {
        let curActive: number | null = null;
        if (activePxNeedsO || activePxNeedsN) {
          curActive = (await resolveVal(activePx, { n, N: n })) ?? null;
        } else if (baseActivePx !== null && baseActivePx > 0) {
          curActive = parseFloat((baseActivePx + priceOffset).toFixed(8));
        }
        order.activePx = curActive;
        order.callbackRatio = callbackRatioVal > 0 ? callbackRatioVal : null;
        order.callbackSpread = callbackSpreadVal > 0 ? callbackSpreadVal : null;
      }

      orders.push(order);
    }

    res.json({ ok: true, orders });
  });

  app.post("/api/preview-amend", express.json(), async (req, res) => {
    const {
      accountId, instId, orderType, tpSlType,
      pxIncrement, triggerPxIncrement,
      tpOrdPxIncrement, slOrdPxIncrement,
      tpPxIncrement, slPxIncrement,
      callbackRatioSpread, activePx,
      newContractSize,
    } = req.body || {};

    const ordersCache = (globalThis as unknown as Record<string, unknown>)?.ORDERS_CACHE as {
      get: (idx: number) => { data: TradeOrder[] } | undefined;
    } | undefined;

    const found = findAccountById(accountId);
    if (!found || !ordersCache) {
      return res.json({ ok: true, orders: [] });
    }

    const { accountIdx, account } = found;
    const allOrders = ordersCache.get(accountIdx)?.data || [];
    const isBinance = String(account.exchange || "").toUpperCase() === 'BINANCE';

    const amendType = orderType || 'limit';
    const matchedOrders = allOrders.filter((o: TradeOrder) => {
      if (instId && o.instId !== instId) return false;
      if (isPendingNewState(o)) return false;
      const oType = (o.ordType || '').toLowerCase();
      if (amendType === 'limit') {
        return ['limit', 'post_only', 'limit_maker'].includes(oType);
      }
      if (amendType === 'trigger') return oType === 'trigger';
      if (amendType === 'conditional') return oType === 'conditional';
      if (amendType === 'oco') return oType === 'oco' || o.algoOrdType === 'oco';
      if (amendType === 'move_order_stop') return oType === 'move_order_stop';
      return false;
    });

    if (matchedOrders.length === 0) {
      return res.json({ ok: true, orders: [] });
    }

    const applyInc = (original: number, incStr: string): number => {
      const trimmed = (incStr || '0').trim();
      if (trimmed.includes('%')) {
        const pct = parseFloat(trimmed.replace('%', '')) / 100;
        return original * (1 + pct);
      }
      return original + (parseFloat(trimmed) || 0);
    };

    const isZero = (s: string) => !s || s.trim() === '' || s.trim() === '0';
    const isDisabled = (s: string) => !s || s.trim() === '' || s.trim() === '-1' || s.trim() === '-0.01';
    const fmt = (n: number) => parseFloat(n.toFixed(8));

    const orders: Array<Record<string, unknown>> = [];

    for (let idx = 0; idx < matchedOrders.length; idx++) {
      const order = matchedOrders[idx];
      const side = (order.side || 'buy').toLowerCase();
      const isBuy = side === 'buy';
      const instIdStr = order.instId || instId || '';
      const isSpot = !instIdStr.endsWith("-SWAP") && !instIdStr.endsWith("-FUTURES") && instIdStr.split("-").length === 2;
      const row: Record<string, unknown> = {
        ordId: order.ordId || order.algoId || '',
        side: order.side || '',
        instId: instIdStr,
      };

      if (amendType === 'limit') {
        const origPx = parseFloat(order.px || order.ordPx || "0");
        if (!isZero(pxIncrement)) {
          const newPx = fmt(applyInc(origPx, pxIncrement));
          row.price = `${origPx}→${newPx}`;
          row.priceChanged = origPx !== newPx;
        } else {
          row.price = String(origPx);
          row.priceChanged = false;
        }
        const attachAlgo = order.attachAlgoOrds?.[0];
        if (tpSlType === 'tp_sl') {
          if (!isDisabled(tpOrdPxIncrement)) {
            const origTp = parseFloat(attachAlgo?.tpTriggerPx || "0");
            const base = !isZero(pxIncrement) ? fmt(applyInc(origPx, pxIncrement)) : origPx;
            const tpInc = parseFloat((tpOrdPxIncrement || '0').replace('%', '')) / ((tpOrdPxIncrement || '').includes('%') ? 100 : 1);
            const newTp = fmt(tpOrdPxIncrement.includes('%') ? base * (1 + (isBuy ? tpInc : -tpInc)) : base + (isBuy ? tpInc : -tpInc));
            row.tpPrice = origTp > 0 ? `${origTp}→${newTp}` : `→${newTp}`;
          }
          if (!isDisabled(slOrdPxIncrement)) {
            const origSl = parseFloat(attachAlgo?.slTriggerPx || "0");
            const base = !isZero(pxIncrement) ? fmt(applyInc(origPx, pxIncrement)) : origPx;
            const slInc = parseFloat((slOrdPxIncrement || '0').replace('%', '')) / ((slOrdPxIncrement || '').includes('%') ? 100 : 1);
            const newSl = fmt(slOrdPxIncrement.includes('%') ? base * (1 + (isBuy ? -slInc : slInc)) : base + (isBuy ? -slInc : slInc));
            row.slPrice = origSl > 0 ? `${origSl}→${newSl}` : `→${newSl}`;
          }
        } else if (tpSlType === 'move_stop') {
          if (!isZero(callbackRatioSpread)) {
            if (callbackRatioSpread.includes('%')) {
              const origRatio = parseFloat(attachAlgo?.callbackRatio || "0") * 100;
              const incPct = parseFloat(callbackRatioSpread.replace('%', ''));
              const newRatio = fmt(origRatio + incPct);
              row.callback = `${origRatio}%→${newRatio}%`;
            } else {
              const origSpread = parseFloat(attachAlgo?.callbackSpread || "0");
              const newSpread = fmt(origSpread + parseFloat(callbackRatioSpread));
              row.callback = `${origSpread}→${newSpread}`;
            }
          }
          if (activePx && activePx.trim() !== '') {
            const origActive = parseFloat(attachAlgo?.activePx || "0");
            if (origActive > 0) {
              const newActive = fmt(applyInc(origActive, activePx));
              row.activePx = `${origActive}→${newActive}`;
            }
          }
        }
      } else if (amendType === 'trigger') {
        const origTrigger = parseFloat(order.triggerPx || order.ordPx || "0");
        const origOrdPx = parseFloat(order.ordPx || order.triggerPx || "0");
        if (!isZero(triggerPxIncrement)) {
          const newTrigger = fmt(applyInc(origTrigger, triggerPxIncrement));
          const newOrdPx = fmt(applyInc(origOrdPx, triggerPxIncrement));
          row.price = `${origTrigger}→${newTrigger}`;
          row.priceChanged = origTrigger !== newTrigger;
        } else {
          row.price = String(origTrigger);
          row.priceChanged = false;
        }
        const attachAlgo = order.attachAlgoOrds?.[0];
        if (tpSlType === 'tp_sl') {
          if (!isDisabled(tpOrdPxIncrement)) {
            const origTp = parseFloat(attachAlgo?.tpTriggerPx || "0");
            const base = !isZero(triggerPxIncrement) ? fmt(applyInc(origTrigger, triggerPxIncrement)) : origTrigger;
            const tpInc = parseFloat((tpOrdPxIncrement || '0').replace('%', '')) / ((tpOrdPxIncrement || '').includes('%') ? 100 : 1);
            const newTp = fmt(tpOrdPxIncrement.includes('%') ? base * (1 + (isBuy ? tpInc : -tpInc)) : base + (isBuy ? tpInc : -tpInc));
            row.tpPrice = origTp > 0 ? `${origTp}→${newTp}` : `→${newTp}`;
          }
          if (!isDisabled(slOrdPxIncrement)) {
            const origSl = parseFloat(attachAlgo?.slTriggerPx || "0");
            const base = !isZero(triggerPxIncrement) ? fmt(applyInc(origTrigger, triggerPxIncrement)) : origTrigger;
            const slInc = parseFloat((slOrdPxIncrement || '0').replace('%', '')) / ((slOrdPxIncrement || '').includes('%') ? 100 : 1);
            const newSl = fmt(slOrdPxIncrement.includes('%') ? base * (1 + (isBuy ? -slInc : slInc)) : base + (isBuy ? -slInc : slInc));
            row.slPrice = origSl > 0 ? `${origSl}→${newSl}` : `→${newSl}`;
          }
        } else if (tpSlType === 'move_stop') {
          if (!isZero(callbackRatioSpread)) {
            if (callbackRatioSpread.includes('%')) {
              const origRatio = parseFloat(attachAlgo?.callbackRatio || "0") * 100;
              const incPct = parseFloat(callbackRatioSpread.replace('%', ''));
              const newRatio = fmt(origRatio + incPct);
              row.callback = `${origRatio}%→${newRatio}%`;
            } else {
              const origSpread = parseFloat(attachAlgo?.callbackSpread || "0");
              const newSpread = fmt(origSpread + parseFloat(callbackRatioSpread));
              row.callback = `${origSpread}→${newSpread}`;
            }
          }
          if (activePx && activePx.trim() !== '') {
            const origActive = parseFloat(attachAlgo?.activePx || "0");
            if (origActive > 0) {
              const newActive = fmt(applyInc(origActive, activePx));
              row.activePx = `${origActive}→${newActive}`;
            }
          }
        }
      } else if (amendType === 'conditional' || amendType === 'oco') {
        const origTp = parseFloat(order.tpTriggerPx || "0");
        const origSl = parseFloat(order.slTriggerPx || "0");
        if (!isZero(tpPxIncrement)) {
          const newTp = fmt(applyInc(origTp, tpPxIncrement));
          row.tpPrice = origTp > 0 ? `${origTp}→${newTp}` : `→${newTp}`;
        }
        if (!isZero(slPxIncrement)) {
          const newSl = fmt(applyInc(origSl, slPxIncrement));
          row.slPrice = origSl > 0 ? `${origSl}→${newSl}` : `→${newSl}`;
        }
      } else if (amendType === 'move_order_stop') {
        const binanceOrder = order as TradeOrder & { callbackRate?: string; activationPrice?: string };
        const origCallback = Number(binanceOrder.callbackRate ?? 0) / 100;
        const origActive = Number(binanceOrder.activationPrice ?? order.triggerPx ?? 0);
        if (!isZero(tpPxIncrement)) {
          const incPct = parseFloat((tpPxIncrement || '0').replace('%', '')) / 100;
          const newCallback = fmt(origCallback + incPct);
          row.callback = `${(origCallback * 100).toFixed(2)}%→${(newCallback * 100).toFixed(2)}%`;
        }
        if (!isZero(slPxIncrement)) {
          const newActive = fmt(applyInc(origActive, slPxIncrement));
          row.activePx = `${origActive}→${newActive}`;
        }
      }

      const origSz = parseFloat(order.sz || "1");
      let marketPrice: number | undefined;
      try { marketPrice = await fetchMarketPrice(instIdStr); } catch {  }
      let positionSize: number | undefined;
      const monitor = AccountMonitor.getInstance();
      const data = monitor.getAccountData(accountIdx);
      if (data?.positions) {
        const pos = data.positions.find(p => p.instId === instIdStr);
        if (pos) positionSize = Math.abs(parseFloat(pos.pos || "0"));
      }
      const newSz = fmt(AmendOrderAction.computeNewSize(origSz, newContractSize || '1', {
        incrementIdx: idx,
        orderPrice: parseFloat(order.ordPx || order.px || "0") || undefined,
        marketPrice,
        positionSize,
      }));
      row.size = `${origSz}→${newSz}`;
      row.sizeChanged = origSz !== newSz;

      orders.push(row);
    }

    res.json({ ok: true, orders });
  });

  app.post("/api/preview-cancel", express.json(), (req, res) => {
    const { accountId, instId, orderTypes, side } = req.body || {};

    const found = findAccountById(accountId);
    if (!found) {
      return res.json({ ok: true, orders: [] });
    }

    const { accountIdx, account } = found;
    const isBinance = String(account.exchange || "").toUpperCase() === 'BINANCE';

    const ordersCache = (globalThis as unknown as Record<string, unknown>)?.ORDERS_CACHE as {
      get: (idx: number) => { data: ExtendedOrder[] } | undefined;
    } | undefined;
    const allOrders = ordersCache ? (ordersCache.get(accountIdx)?.data || []) : [];

    const filteredOrders = allOrders.filter((o: ExtendedOrder) => {
      if (instId && !SymbolUtils.isSameSymbol(o.instId, instId)) return false;
      if (isPendingNewState(o)) return false;
      if (side) {
        const orderSide = String(o.side || '').toLowerCase();
        if (orderSide !== side.toLowerCase()) return false;
      }
      const type = (o.algoOrdType || o.ordType || o.type || '').toLowerCase();
      if (orderTypes && orderTypes.length > 0) {
        const isTrailingStop = isBinance && (
          type === 'move_order_stop' || type === 'trailing_stop_market' ||
          String(o._execType || o.orderType || o.type || '').toUpperCase() === 'TRAILING_STOP_MARKET' ||
          (Number(o.trailingDelta) > 0 || Number(o.callbackRate) > 0 || Number(o.priceRate) > 0)
        );
        const resolvedType = isTrailingStop && type === 'conditional' ? 'move_order_stop' : type;
        let matched = orderTypes.includes(resolvedType);
        if (!matched && isBinance) {
          if (orderTypes.includes('oco') && (o.contingencyType === 'OCO' || (!o.contingencyType && !!o.orderListId))) matched = true;
          if (orderTypes.includes('conditional') && !o.orderListId && ['stop_loss_limit', 'take_profit_limit', 'stop_market', 'take_profit_market', 'stop_loss', 'take_profit'].includes(type) && !isTrailingStop) matched = true;
          if (orderTypes.includes('move_order_stop') && isTrailingStop) matched = true;
          if (orderTypes.includes('post_only') && (type === 'limit_maker' || type === 'post_only')) matched = true;
        }
        if (!matched) return false;
      }
      return true;
    });

    const result = filteredOrders.map((o: ExtendedOrder) => ({
      instId: o.instId || '',
      side: o.side || '',
      ordType: o.algoOrdType || o.ordType || o.type || '',
    }));

    res.json({ ok: true, orders: result });
  });

  app.post("/api/preview-close", express.json(), (req, res) => {
    const {
      accountId, instId, mgnMode, posSide,
      uplFilter, uplRatioFilter,
    } = req.body || {};

    const found = findAccountById(accountId);
    if (!found) {
      return res.json({ ok: true, positions: [] });
    }

    const { accountIdx } = found;

    const monitor = AccountMonitor.getInstance();
    const accountData = monitor.getAccountData(accountIdx);
    let positions = (accountData?.positions || []).filter((p: OKXPosition) => parseFloat(p.pos || '0') !== 0);

    if (instId) {
      positions = positions.filter((p: OKXPosition) => SymbolUtils.isSameSymbol(p.instId, instId));
    }

    if (mgnMode) {
      positions = positions.filter((p: OKXPosition) => p.mgnMode === mgnMode);
    }

    if (posSide) {
      positions = positions.filter((p: OKXPosition) => p.posSide === posSide);
    }

    if (uplFilter) {
      const match = uplFilter.match(/^([<>=≤≥]+)\s*([\d.-]+)$/);
      if (match) {
        const [, operator, valueStr] = match;
        const threshold = parseFloat(valueStr);
        if (Number.isFinite(threshold)) {
          positions = positions.filter((p: OKXPosition) => {
            const val = parseFloat(p.upl || '0');
            switch (operator) {
              case '>': return val > threshold;
              case '<': return val < threshold;
              case '=': return val === threshold;
              case '≥': case '>=': return val >= threshold;
              case '≤': case '<=': return val <= threshold;
              default: return true;
            }
          });
        }
      }
    }

    if (uplRatioFilter) {
      const cleanFilter = uplRatioFilter.replace(/%/g, '');
      const match = cleanFilter.match(/^([<>=≤≥]+)\s*([\d.-]+)$/);
      if (match) {
        const [, operator, valueStr] = match;
        const threshold = parseFloat(valueStr);
        if (Number.isFinite(threshold)) {
          positions = positions.filter((p: OKXPosition) => {
            const val = parseFloat(p.uplRatio || '0') * 100;
            switch (operator) {
              case '>': return val > threshold;
              case '<': return val < threshold;
              case '=': return val === threshold;
              case '≥': case '>=': return val >= threshold;
              case '≤': case '<=': return val <= threshold;
              default: return true;
            }
          });
        }
      }
    }

    const result = positions.map((p: OKXPosition) => ({
      instId: p.instId || '',
      mgnMode: p.mgnMode || '',
      posSide: p.posSide || '',
      upl: p.upl || '0',
      uplRatio: p.uplRatio || '0',
    }));

    res.json({ ok: true, positions: result });
  });
}

function registerFundingRateSubRoutes(app: Application): void {
  app.get("/api/funding-rates", async (req: Request, res: Response) => {
    const rawParam = req.query.instIds;
    const instIds = (Array.isArray(rawParam) ? rawParam : (rawParam ? String(rawParam).split(',') : []))
      .map(s => s.trim()).filter(Boolean);
    if (instIds.length === 0) {
      return res.json({ ok: true, data: {} });
    }
    try {
      const resultMap = await fetchFundingRates(instIds);
      const data: Record<string, { rate: string; displayText: string; nextFundingTime?: string }> = {};
      resultMap.forEach((v, k) => {
        data[k] = { rate: v.rate, displayText: v.displayText, nextFundingTime: v.nextFundingTime };
      });
      res.json({ ok: true, data });
    } catch (e: unknown) {
      ErrorMonitor.captureError(toError(e), ErrorLevel.LOW, ErrorCategory.SYSTEM);
      res.json({ ok: true, data: {} });
    }
  });
}

function registerLocaleSubRoutes(app: Application): void {
  app.post("/api/system/locale", asyncHandler(async (req, res) => {
    const { locale } = req.body;
    if (locale !== 'zh-CN' && locale !== 'en-US') {
      return res.status(400).json({ error: 'Invalid locale' });
    }
    DiyEngine.getInstance().setLocale(locale);
    res.json({ ok: true, locale });
  }));
}
