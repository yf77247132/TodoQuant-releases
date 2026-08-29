
import type { LogKeyParams } from '../types/logs';

function tOp(op: string): string {
  const map: Record<string, string> = {
    '下单': 'Place Order', '修改': 'Amend', '改单': 'Amend',
    '撤单': 'Cancel', '平仓': 'Close',
    '转账': 'Transfer', '划转': 'Transfer',
    '补仓': 'Margin Add',
  };
  return map[op] || op;
}

type LogTranslator<P extends LogKeyParams> = (p: P) => string;

const WSErrorZh: Record<number, string> = {
  4001: '登录失败', 4002: '参数不合法', 4003: '登录账户多于100个',
  4004: '空闲超时30秒', 4005: '写缓冲区满', 4006: '异常场景关闭',
  4007: 'API key已更新或删除，请重新连接', 4008: '总订阅频道数超限',
  4009: '连接订阅频道数超限', 60009: '登录失败', 60024: 'Passphrase不正确',
  60032: 'API Key不存在', 64008: '服务升级中',
};
const WSErrorEn: Record<number, string> = {
  4001: 'Login failed', 4002: 'Invalid parameter', 4003: 'Over 100 accounts logged in',
  4004: 'Idle timeout 30s', 4005: 'Write buffer full', 4006: 'Abnormal close',
  4007: 'API key updated or deleted, please reconnect', 4008: 'Total subscription channels exceeded',
  4009: 'Connection subscription channels exceeded', 60009: 'Login failed',
  60024: 'Passphrase incorrect', 60032: 'API key does not exist', 64008: 'Service upgrading',
};

export function composeField(key: string, params: Record<string, string | number | boolean>): string {
  const template = LOG_TEMPLATES[key];
  return template ? template.zh(params as any) : `[${key}]`;
}

function renderOrderFields(p: Record<string, string | number | boolean>, isEn: boolean): string {
  const enValueMap: Record<string, string> = {
    '市价': 'Market', '未知': 'Unknown',
  };
  const pairs: [string | number | boolean, string, string][] = ORDER_FIELD_EN.map(
    ([key, zh, en]) => [p[key], zh, en]
  );
  return pairs
    .filter(([val]) => {
      if (val === undefined || val === null || val === '' || val === false) return false;
      if (val === 0 || val === -1 || val === '-1') return false;
      return true;
    })
    .map(([val, zhLabel, enLabel]) => {
      const strVal = String(val);
      let displayVal = isEn ? (enValueMap[strVal] || strVal) : strVal;
      if (zhLabel === '回调比例' || enLabel === 'Callback Ratio') {
        const numVal = parseFloat(strVal);
        if (!isNaN(numVal) && numVal >= 0 && numVal <= 1) {
          displayVal = `${(numVal * 100).toFixed(0)}%`;
        }
      }
      return `${isEn ? enLabel : zhLabel}: ${displayVal}`;
    })
    .join(', ');
}

function buildOrderResultTemplate(zhPrefix: string, enPrefix: string): {
  zh: (p: Record<string, string | number | boolean>) => string;
  en: (p: Record<string, string | number | boolean>) => string;
} {
  return {
    zh: (p) => {
      const fields = renderOrderFields(p, false) || String(p.detail || '');
      return p.ordId
        ? `${zhPrefix} #${p.num}: 订单ID=${p.ordId}, ${fields}`
        : `${zhPrefix} #${p.num}: ${fields}`;
    },
    en: (p) => {
      const fields = renderOrderFields(p, true) || String(p.detail || '');
      return p.ordId
        ? `${enPrefix} #${p.num}: ID=${p.ordId}, ${fields}`
        : `${enPrefix} #${p.num}: ${fields}`;
    },
  };
}

function buildCancelResultTemplate(zhPrefix: string = '✅ 撤单成功', enPrefix: string = '✅ Cancel OK'): {
  zh: (p: Record<string, string | number | boolean>) => string;
  en: (p: Record<string, string | number | boolean>) => string;
} {
  const cancelFieldPairs: [string, string][] = [
    ['type', '类型'], ['instId', '交易对'],
    ['triggerPx', '触发价'], ['px', '委托价'], ['tpTriggerPx', '止盈触发价'],
    ['slTriggerPx', '止损触发价'], ['side', '方向'], ['targetPx', '目标价'],
    ['chaseOffset', '追逐偏移'], ['callbackRatio', '回调比例'], ['callbackSpread', '回调价距'],
    ['sz', '数量'],
  ];

  function renderCancelFields(p: Record<string, string | number | boolean>, isEn: boolean): string {
    const formatNumber = (val: string): string => {
      if (val === '-' || val === '0' || val === '0.00000000') return '-';
      if (!/^-?\d+(\.\d+)?$/.test(val)) return val;
      const num = parseFloat(val);
      if (!isNaN(num) && num !== 0) {
        return num.toString();
      }
      return val;
    };

    const localDisplay = (val: string) => formatNumber(val);

    const isTrailingStop = String(p.type || '').includes('移动止盈止损') || String(p.type || '').includes('Trailing');
    const fieldsToSkip = isTrailingStop ? ['px', 'tpTriggerPx', 'slTriggerPx'] : [];

    return cancelFieldPairs
      .filter(([key]) => {
        if (fieldsToSkip.includes(key)) return false;

        const val = p[key];
        if (val === undefined || val === null || val === '' || val === '-') return false;
        const strVal = String(val);
        if (strVal === '0' || strVal === '0.00000000') return false;
        return true;
      })
      .map(([key, zhLabel]) => {
        const val = localDisplay(String(p[key]));
        const label = isEn ? (CANCEL_FIELD_EN[key] || key) : zhLabel;
        const displayVal = isEn ? (ORDER_TYPE_EN[val] || val) : val;
        return `${label}: ${displayVal}`;
      })
      .join(', ');
  }

  return {
    zh: (p) => {
      const fields = renderCancelFields(p, false) || String(p.detail || '');
      return `${zhPrefix} #${p.num}: ${p.ordId ? '订单ID=' + p.ordId + ', ' : ''}${fields}`;
    },
    en: (p) => {
      const fields = renderCancelFields(p, true) || String(p.detail || '');
      return `${enPrefix} #${p.num}: ${p.ordId ? 'ID=' + p.ordId + ', ' : ''}${fields}`;
    },
  };
}

export function encodeDescFields(segments: { label: string; value: string }[]): string {
  return JSON.stringify(segments);
}

const AMEND_FIELD_EN: Array<[RegExp, string]> = [
  [/止盈触发价\s*:/g, 'TP Trigger:'],
  [/止盈委托价\s*:/g, 'TP Price:'],
  [/止损触发价\s*:/g, 'SL Trigger:'],
  [/止损委托价\s*:/g, 'SL Price:'],
  [/止盈价\s*:/g, 'TP Price:'],
  [/止损价\s*:/g, 'SL Price:'],
  [/回调幅度比例\s*:/g, 'Callback Ratio:'],
  [/激活价格\s*:/g, 'Activation Price:'],
  [/triggerPx\s*:/g, 'Trigger Px:'],
  [/ordPx\s*:/g, 'Order Px:'],
  [/触发价\s*:/g, 'Trigger:'],
  [/委托价\s*:/g, 'Price:'],
  [/数量\s*:/g, 'Size:'],
  [/详情\s*:\s*/g, 'Details: '],
  [/传参\s*:/g, 'Params: '],
  [/止损\s*:\s*无\s*\(该订单未设置止损\)/g, 'SL: None (order has no SL)'],
];

export function translateAmendDetail(detail: string): string {
  return AMEND_FIELD_EN.reduce((s, [re, en]) => s.replace(re, en), detail);
}

const CANCEL_DETAIL_EN: Array<[RegExp, string]> = [
  [/限价主单 \(OTO\)/g, 'Limit Main (OTO)'],
  [/止盈子单 \(OTO\)/g, 'TP Sub (OTO)'],
  [/止损子单 \(OTO\)/g, 'SL Sub (OTO)'],
  [/限价委托（带止盈止损）/g, 'Limit (with TP/SL)'],
  [/止盈触发价\s*:/g, 'TP Trigger:'],
  [/止损触发价\s*:/g, 'SL Trigger:'],
  [/回调比例\s*:/g, 'Callback Ratio:'],
  [/回调价距\s*:/g, 'Callback Spread:'],
  [/目标价\s*:/g, 'Target:'],
  [/追逐偏移\s*:/g, 'Chase Offset:'],
  [/移动止盈止损/g, 'Trailing Stop'],
  [/双向止盈止损/g, 'OCO'],
  [/单向止盈止损/g, 'Stop'],
  [/计划委托/g, 'Trigger'],
  [/限价委托/g, 'Limit'],
  [/市价委托/g, 'Market'],
  [/订单ID\s*:\s*/g, 'Order ID: '],
  [/类型\s*:\s*/g, 'Type: '],
  [/交易对\s*:\s*/g, 'Trading Pair: '],
  [/触发价\s*:\s*/g, 'Trigger: '],
  [/委托价\s*:\s*/g, 'Price: '],
  [/数量\s*:\s*/g, 'Size: '],
  [/方向\s*:\s*/g, 'Side: '],
  [/详情\s*:\s*/g, 'Details: '],
  [/模拟撤算法单成功\s*:\s*/g, 'Sim cancel algo success: '],
  [/模拟撤普通单成功\s*:\s*/g, 'Sim cancel success: '],
  [/买/g, 'Buy'],
  [/卖/g, 'Sell'],
  [/普通/g, 'Standard'],
  [/算法/g, 'Algo'],
];

function translateCancelDetail(detail: string): string {
  return CANCEL_DETAIL_EN.reduce((s, [re, en]) => s.replace(re, en), detail);
}

export function translateCloseDetail(detail: string): string {
  return detail
    .replace(/交易对=/g, 'Pair: ')
    .replace(/方向=/g, 'Side: ')
    .replace(/仓位模式=/g, 'Mode: ')
    .replace(/持仓数量=/g, 'Size: ')
    .replace(/开仓均价=/g, 'Avg Px: ')
    .replace(/收益额=/g, 'UPL: ')
    .replace(/双向持仓-多仓/g, 'Long')
    .replace(/双向持仓-空仓/g, 'Short')
    .replace(/单向持仓/g, 'Net')
    .replace(/全仓/g, 'Cross')
    .replace(/逐仓/g, 'Isolated')
    .replace(/现货/g, 'Cash');
}

function translateMarginMode(mode: string): string {
  return mode
    .replace('从资金账户划转', 'transfer from funding')
    .replace('从赚币赎回并划转', 'redeem from savings & transfer');
}

function translateMarginDest(dest: string): string {
  return DESC_VALUE_EN[dest] || dest;
}

function translateMarginDestZh(dest: string): string {
  const map: Record<string, string> = {
    'SPOT': '现货账户', 'MARGIN': '杠杆全仓',
    'USDT_FUTURE': 'U本位合约', 'COIN_FUTURE': '币本位合约',
    'FUNDING': '资金账户', '18': '交易账户', '6': '资金账户',
  };
  return map[dest] || dest;
}

function translateMarginModeZh(mode: string): string {
  return mode
    .replace('transfer from funding', '从资金账户划转')
    .replace('redeem from savings & transfer', '从赚币赎回并划转');
}

function translateResolveError(reason: string): string {
  return reason
    .replace('缺少 account_id，请重新选择账户', 'Missing account_id, please re-select account')
    .replace('账户ID ', 'Account ID ')
    .replace('对应的账户不存在（可能已被删除），请重新选择账户', 'not found (may have been deleted), please re-select')
    .replace('账户 ', 'Account ')
    .replace('缺少 API 密钥，请先添加账户或解锁 Master Key', 'missing API key, please add account or unlock Master Key');
}

function translateModule(module: string): string {
  const map: Record<string, string> = {
    '批量下单': 'Batch Place', '批量改单': 'Batch Amend', '批量撤单': 'Batch Cancel',
    '批量平仓': 'Batch Close', '批量转账': 'Batch Transfer',
  };
  return map[module] || module;
}

function translateDiyActionType(label: string): string {
  const map: Record<string, string> = {
    '下单模块': 'Place Order',
    '改单模块': 'Amend Order',
    '撤单模块': 'Cancel Order',
    '平仓模块': 'Close Position',
    '转账模块': 'Transfer',
    '停止策略': 'Stop Strategy',
    '通知': 'Notify',
    '划转': 'Transfer',
  };
  return map[label] || label;
}

const COND_LABEL_ZH: Record<string, string> = {
  'account.availableBalance': '交易可用 (₮)',
  'field.defaultAccount': '账号',
  'field.threshold': '阈值 (₮)',
  'field.directionIs': '判断逻辑',
  'field.instrument': '交易对',
  'field.posCountValue': '持仓数量',
  'field.posSizeValue': '持仓量',
  'field.pnlAmountValue': '收益额 (₮)',
  'field.pnlRateValue': '收益率 (%)',
  'field.marginValue': '保证金',
  'field.direction': '方向',
  'field.liquidationDistance': '爆仓距离',
  'field.liqDistValue': '强平距离',
  'field.fundingRateValue': '资金费率',
  'field.marginRatioValue': '保证金率',
  'field.timezone': '时区',
  'field.weekly': '允许日期',
  'field.minutes': '分钟',
  'field.seconds': '秒',
  'field.dailyLimit': '每日限制',
  'field.condition': '条件名',
  'field.tvSignalValue': '信号值',
  'operator.lt': '小于 (<)',
  'operator.gt': '大于 (>)',
  'operator.eq': '等于 (=)',
  'operator.lte': '小于等于 (<=)',
  'operator.gte': '大于等于 (>=)',
};
const COND_LABEL_EN: Record<string, string> = {
  'account.availableBalance': 'Trading Available (₮)',
  'field.defaultAccount': 'Account',
  'field.threshold': 'Threshold (₮)',
  'field.directionIs': 'Logic',
  'field.instrument': 'Instrument',
  'field.posCountValue': 'Positions',
  'field.posSizeValue': 'Size',
  'field.pnlAmountValue': 'UPL',
  'field.pnlRateValue': 'UPL (%)',
  'field.marginValue': 'Margin',
  'field.direction': 'Side',
  'field.liquidationDistance': 'Liq. Dist.',
  'field.liqDistValue': 'Liq. Dist.',
  'field.fundingRateValue': 'Funding Rate',
  'field.marginRatioValue': 'Mgn.%',
  'field.timezone': 'Timezone',
  'field.weekly': 'Allowed Days',
  'field.minutes': 'Minutes',
  'field.seconds': 'Seconds',
  'field.dailyLimit': 'Daily Limit',
  'field.condition': 'Condition',
  'field.tvSignalValue': 'Signal',
  '指标条件': 'Indicator Condition',
  '时间窗口': 'Time Window',
  '冷却': 'Cooldown',
  '触发冷却': 'Cooldown',
  '次数限制': 'Trigger Limit',
  '触发次数限制': 'Trigger Limit',
  'TV信号': 'TV Signal',
  'TradingView 信号': 'Webhook Signal',
  '余额检测': 'Balance Check',
  '仓位个数': 'Position Count',
  '方向检测': 'Direction Check',
  '收益额检测': 'PnL Amount Check',
  '收益率检测': 'PnL Rate Check',
  '保证金检测': 'Margin Check',
  '保证金率检测': 'Margin Ratio Check',
  '持仓量检测': 'Size Limit Check',
  '距离爆仓检测': 'Liq. Distance Check',
  '资金费率检测': 'Funding Rate Check',
  '涨幅检测': 'Price Change',
  '24H涨幅检测': '24H Change',
  '当日涨幅检测': 'Daily Change',
  '指标': 'Indicator',
  '无冷却': 'No cooldown',
  '多': 'Long',
  '空': 'Short',
  'operator.lt': '<',
  'operator.gt': '>',
  'operator.eq': '=',
  'operator.lte': '<=',
  'operator.gte': '>=',
  '上穿': 'Cross Above',
  '下穿': 'Cross Below',
};

function translateCondEvalDetail(detail: string, lang: 'zh' | 'en'): string {
  const map = lang === 'zh' ? COND_LABEL_ZH : COND_LABEL_EN;
  let result = detail;
  if (lang === 'en') {
    result = result.replace('检测: ', 'Check: ');
    result = result.replace('结果: 触发', 'Result: triggered');
    result = result.replace('结果: 未触发', 'Result: not triggered');
    result = result.replace('仓位方向: ', 'Side: ');
    result = result.replace('目标: ', 'Target: ');
    result = result.replace('全部', 'All');
    result = result.replace('[无]', '[None]');
    result = result.replace('从未使用', 'Never used');
    result = result.replace('剩余: ', 'Remaining: ');
    result = result.replace('已触发: ', 'Triggered: ');
    result = result.replace('信号: 有', 'Signal: Yes');
    result = result.replace('信号: 无', 'Signal: No');
    result = result.replace('当前: ', 'Current: ');
    result = result.replace('允许: ', 'Allowed: ');
    result = result.replace('24h涨幅: ', '24h Change: ');
    result = result.replace('当日涨幅: ', 'Daily Change: ');
    result = result.replace('阈值: ', 'Threshold: ');
    result = result.replace('判断逻辑: ', 'Logic: ');
    result = result.replace(/个交易对满足/g, ' pairs matched');
    result = result.replace('已触发过', 'already triggered');
    result = result.replace('首次检测', 'First check');
    result = result.replace('数据预热中', 'Data warming up');
    result = result.replace('数据未就绪', 'Data not ready');
    result = result.replace(/最高(\d)/g, 'Max $1');
    result = result.replace('开盘价', 'Open');
    result = result.replace('收盘价', 'Close');
    result = result.replace('最高价', 'High');
    result = result.replace('最低价', 'Low');
    result = result.replace('价格', 'Price');
    result = result.replace('成交量', 'Volume');
    result = result.replace('星期日', 'Sunday');
    result = result.replace('星期一', 'Monday');
    result = result.replace('星期二', 'Tuesday');
    result = result.replace('星期三', 'Wednesday');
    result = result.replace('星期四', 'Thursday');
    result = result.replace('星期五', 'Friday');
    result = result.replace('星期六', 'Saturday');
    result = result.replace('日, 一, 二, 三, 四, 五, 六', 'Sun, Mon, Tue, Wed, Thu, Fri, Sat');
  }
  for (const [k, v] of Object.entries(map)) result = result.split(k).join(v);
  return result;
}

export const DESC_FIELD_EN: Record<string, string> = {
  '账号': 'Account', '账户': 'Account', '交易对': 'Trading Pair', '订单类型': 'Order Type',
  '仓位': 'Position Side', '持仓方向': 'Position Side', '模式': 'Mode', '方向': 'Side',
  '递增': 'Increment', '类型': 'Type', '触发价': 'Trigger Price',
  '委托价': 'Order Price', '止盈': 'Take Profit (TP)', '止损': 'Stop Loss (SL)',
  '止盈幅度': 'TP Spread', '止损幅度': 'SL Spread',
  '止盈价': 'Take Profit (TP)', '止损价': 'Stop Loss (SL)',
  '价距': 'Spread', '回调比例': 'Callback', '回调价距': 'Spread', '回调比例/价距': 'Callback/Gap',
  '激活价格': 'Activation Price', '激活价': 'Activation Price', '间隔': 'Interval', '订单': 'Order',
  '数量': 'Size', '实盘': 'Real Execution', '反手': 'Reverse', '跳过': 'Skip',
  '测试': 'Test', '限价': 'Limit Order', '市价': 'Market Order',
  '触发': 'Trigger', '追逐': 'Chase', '回调': 'Callback',
  '递增步长': 'Increment Step', '止盈增减': 'TP Adjustment',
  '止损增减': 'SL Adjustment', '触发价增幅': 'Trigger Px Increment',
  '委托价增幅': 'Order Px Increment', '回调幅度比例': 'Callback Ratio',
  '回调幅度价距': 'Callback Spread',
  '回调幅度比例/价距增减': 'Callback Ratio/Spread Adjustment',
  '回调幅度比例增减': 'Callback Ratio Adjustment',
  '激活价格增减': 'Activation Price Adjustment', '转账数量': 'Transfer Amount',
  '支付账户': 'Pay Account', '目标比例': 'Target Ratio',
  '最小保证金': 'Min Margin', '最大保证金率': 'Max Margin Ratio',
  '到账账户': 'Destination',
  '订单方向': 'Order Side', '收益额': 'UPL', '收益率': 'UPL Ratio',
};

export const DESC_VALUE_EN: Record<string, string> = {
  '全部': 'All', '所有': 'All', '全部策略': 'All Strategies', '开': 'On', '关': 'Off',
  '买': 'Buy', '卖': 'Sell',
  '多': 'Long', '空': 'Short',
  '单向': 'Net', '双多': 'Long', '双空': 'Short',
  '双向多头': 'Long', '双向空头': 'Short',
  '全仓': 'Cross', '逐仓': 'Isolated', '现货': 'Cash',
  '↑递增': '↑ Up', '↑': '↑ Up', '↓递减': '↓ Down',
  '限价委托': 'Limit Order', '市价委托': 'Market Order',
  '计划委托': 'Trigger Order', '高级限价': 'Limit-Post only',
  '限价-Post only': 'Limit-Post only', '限价 - Post only': 'Limit-Post only',
  '限价-FOK': 'FOK', '限价-IOC': 'IOC',
  '双向止盈止损': 'OCO Order', '单向止盈止损': 'Conditional TP/SL',
  '移动止盈止损': 'Trailing Stop', '追逐限价': 'Chase Order',
  '回调': 'Callback',
  '触发/委托价': 'Trigger/Order Price', '触发价': 'Trigger Price',
  '委托价': 'Order Price', '限价': 'Limit',
  '触发价增幅': 'Trigger Px Increment', '委托价增幅': 'Order Px Increment',
  '止盈增减': 'TP Adjustment', '止损增减': 'SL Adjustment',
  '止盈': 'Take Profit (TP)', '止损': 'Stop Loss (SL)',
  '双向': 'Both', '长仓': 'Long', '短仓': 'Short',
  '划转': 'Transfer', '补仓': 'Add Margin', '赎回': 'Redeem',
  '交易账户（USDT）→ 理财账户（USDC）': 'Trading (USDT) → Savings (USDC)',
  '赚币-USDT': 'Savings-USDT', '资金-USDT': 'Funding-USDT',
  '交易账户': 'Trading Account', '理财账户': 'Savings Account',
  '理财（USDC）': 'Savings (USDC)',
};

function renderDescFields(descFields: string, isEn: boolean): string {
  try {
    const segments: { label: string; value: string }[] = JSON.parse(descFields);
    return segments
      .map(s => {
        const label = isEn ? (DESC_FIELD_EN[s.label] || s.label) : s.label;
        const value = isEn ? (DESC_VALUE_EN[s.value] || s.value) : s.value;
        return `${label}: ${value}`;
      })
      .join(', ');
  } catch {
    return '';
  }
}

export const CANCEL_FIELD_EN: Record<string, string> = {
  ordId: 'ID', type: 'Type', instId: 'Trading Pair',
  triggerPx: 'Trigger', px: 'Order Price', tpTriggerPx: 'TP Trigger',
  slTriggerPx: 'SL Trigger', side: 'Side', targetPx: 'Target',
  chaseOffset: 'Chase', callbackRatio: 'Callback', callbackSpread: 'Spread',
  sz: 'Size',
};

export const ORDER_TYPE_EN: Record<string, string> = {
  '限价委托': 'Limit', '市价委托': 'Market', '限价-Post only': 'Post Only',
  '单向止盈止损': 'Trigger', '双向止盈止损': 'OCO', '移动止盈止损': 'Trailing Stop',
  '限价委托（带止盈止损）': 'Limit (OTO)', '计划委托': 'Trigger',
  '追逐限价': 'Chase', '所有': 'All', '买': 'Buy', '卖': 'Sell',
};

export const ORDER_FIELD_EN: [string, string, string][] = [
  ['triggerPx', '触发价', 'Trigger'],
  ['ordPx', '委托价', 'Price'],
  ['tp', '止盈幅度', 'TP'],
  ['chase', '价距', 'Chase'],
  ['callbackRatio', '回调比例', 'Callback Ratio'],
  ['callbackSpread', '回调价距', 'Callback Spread'],
  ['activePx', '激活价', 'Active Price'],
  ['sl', '止损幅度', 'SL'],
  ['tpPx', '止盈', 'TP'],
  ['slPx', '止损', 'SL'],
  ['sz', '数量', 'Size'],
];

const TRANSLATE_API_ERROR_MAP: Record<string, string> = {
  '请求超时 (10秒)': 'Request timeout (10s)',
  '请求超时 (ETIMEDOUT)': 'Request timeout (ETIMEDOUT)',
  '请求时间戳已过期': 'Timestamp request expired',
  '请求时间戳超出接收窗口': 'Timestamp outside recvWindow',
  'API Key 无效': 'Invalid API key',
  '签名验证失败': 'Invalid sign',
  'Passphrase 不正确': 'PASSPHRASE incorrect',
  '登录已过期': 'Login is expired',
  '请求频率超限': 'Rate limit reached',
  '系统错误': 'System error',
  '参数错误': 'Parameter error',
  '订单不存在': 'Order does not exist',
  '余额不足': 'Insufficient balance',
  '网络请求超时 (ETIMEDOUT)': 'Network timeout (ETIMEDOUT)',
  '连接被远端重置 (ECONNRESET)': 'Connection reset (ECONNRESET)',
  '网络: ': 'Network: ',
};
function translateApiError(msg: string): string {
  return Object.entries(TRANSLATE_API_ERROR_MAP).reduce((s, [zh, en]) => s.split(zh).join(en), msg);
}

export const LOG_TEMPLATES: Record<string, {
  zh: LogTranslator<any>;
  en: LogTranslator<any>;
  category?: 'USER' | 'SYSTEM' | 'API';
}> = {

  'system.time.syncFailed': {
    category: 'SYSTEM',
    zh: (p: { count: number; msg: string; retryAfter: number }) =>
      `时间戳同步失败 (${p.count}次): ${p.msg}，将在 ${p.retryAfter}秒后重试`,
    en: (p) => `Timestamp sync failed (${p.count} time(s)): ${p.msg}, will retry in ${p.retryAfter}s`,
  },
  'system.time.syncRecovered': {
    zh: (p: { count: number }) =>
      `时间戳同步恢复（此前连续失败 ${p.count} 次）`,
    en: (p) => `Timestamp sync recovered (previously failed ${p.count} consecutive time(s))`,
  },

  'strategy.start': {
    zh: (p: { type: string; name: string; desc: string; descFields?: string }) => {
      const fields = p.descFields ? renderDescFields(p.descFields, false) : p.desc;
      return `策略启动, ${p.type}配置: ${p.name}, ${fields}`;
    },
    en: (p: { type: string; name: string; desc: string; descFields?: string }) => {
      const typeEn: Record<string, string> = { '下单': 'Order', '改单': 'Amend', '撤单': 'Cancel', '平仓': 'Close', '转账': 'Transfer' };
      const fields = p.descFields ? renderDescFields(p.descFields, true) : p.desc;
      return `Strategy started, ${typeEn[p.type] || p.type} config: ${p.name}, ${fields}`;
    },
  },
  'strategy.start.base': {
    zh: (p: { name: string }) => `策略启动: ${p.name}`,
    en: (p) => `Strategy started: ${p.name}`,
  },
  'order.fetching.list': {
    zh: () => '查询订单列表...',
    en: () => 'Fetching order list...',
  },
  'order.fetching.list.failed': {
    category: 'API',
    zh: (p: { msg: string }) => `查询订单列表失败: ${p.msg}`,
    en: (p) => `Fetching order list failed: ${p.msg}`,
  },
  'order.skip.duplicate.trigger': {
    zh: (p: { px: string }) => `触发价 ${p.px} 已存在, 跳过`,
    en: (p) => `Trigger price ${p.px} already exists, skip`,
  },
  'order.skip.duplicate.chase': {
    zh: (p: { val: string }) => `价距 ${p.val} 已存在, 跳过`,
    en: (p) => `Spread ${p.val} already exists, skip`,
  },
  'order.skip.duplicate.active': {
    zh: (p: { px: string }) => `激活价 ${p.px} 已存在, 跳过`,
    en: (p) => `Activation price ${p.px} already exists, skip`,
  },
  'order.skip.duplicate.ordPx': {
    zh: (p: { px: string }) => `委托价 ${p.px} 已存在, 跳过`,
    en: (p) => `Order price ${p.px} already exists, skip`,
  },
  'order.market.preFetch': {
    zh: (p: { price: string }) => `市价委托预获取实时行情: ${p.price}`,
    en: (p) => `Market order pre-fetching market price: ${p.price}`,
  },
  'order.conditional.preFetch': {
    zh: (p: { price: string }) => `单向止盈止损预获取实时行情: ${p.price}`,
    en: (p) => `Conditional TP/SL pre-fetching market price: ${p.price}`,
  },
  'order.net.detect': {
    zh: (p: { triggerPx: string; marketPx: string; dir: string; result: string }) =>
      `单向订单自动识别: 触发价=${p.triggerPx}, 市场价=${p.marketPx}, 价格 ${p.dir} 市场价, 识别为 [${p.result}] 单`,
    en: (p: { triggerPx: string; marketPx: string; dir: string; result: string }) => {
      const enResult = p.result === '止盈' ? 'Take Profit' : p.result === '止损' ? 'Stop Loss' : p.result;
      return `Net order auto-detection: Trigger Price=${p.triggerPx}, Market Price=${p.marketPx}, Price ${p.dir} Market Price, detected as [${enResult}] order`;
    },
  },
  'strategy.stopped': {
    zh: (p: { reason?: string }) =>
      p.reason === '单次执行完毕' ? '单次执行完毕' : `脚本已停止${p.reason ? '：' + p.reason : ''}`,
    en: (p: { reason?: string }) =>
      p.reason === '单次执行完毕' ? 'Single execution completed' : `Script stopped${p.reason ? ': ' + p.reason : ''}`,
  },
  'strategy.done': {
    zh: () => '单次执行完毕',
    en: () => 'Single execution completed',
  },
  'strategy.busy': {
    zh: (p: { action: string }) =>
      `正在执行其他操作，忽略${p.action}请求`,
    en: (p) => `Executing other operation, ignoring ${p.action} request`,
  },
  'strategy.noapikey': {
    category: 'USER',
    zh: (p: { module: string }) =>
      `${p.module}错误: 账户缺少 API 密钥，请先在 API密钥管理 添加账户`,
    en: (p) => `${p.module} error: Account missing API key, please add in API Keys management`,
  },
  'strategy.validation.accountResolve': {
    category: 'USER',
    zh: (p: { reason: string }) => p.reason,
    en: (p) => p.reason,
  },
  'strategy.missing.apikey': {
    category: 'USER',
    zh: (p: { accountIdx: number; label?: string }) =>
      `账户 ${p.label || p.accountIdx} 缺少 API 密钥，请先在 API密钥管理 添加账户或解锁 Master Key`,
    en: (p) => `Account ${p.label || p.accountIdx} missing API key, please add account or unlock Master Key`,
  },
  'strategy.missing.passphrase': {
    category: 'USER',
    zh: (p: { accountIdx: number; label?: string }) =>
      `账户 ${p.label || p.accountIdx} 缺少 passphrase（OKX 必填），请在 API密钥管理 补全设置`,
    en: (p) => `Account ${p.label || p.accountIdx} missing passphrase (OKX required), please complete in API Keys`,
  },

  'trader.validation.orderCount': {
    category: 'USER',
    zh: () => '下单数量必须为大于 0 的整数，请检查配置',
    en: () => 'Order count must be a positive integer, please check configuration',
  },
  'trader.validation.interval': {
    category: 'USER',
    zh: () => '下单间隔必须为大于等于 0 的数值，请检查配置',
    en: () => 'Order interval must be >= 0, please check configuration',
  },
  'trader.validation.firstPrice': {
    category: 'USER',
    zh: () => '首单价格必须大于 0，请检查配置',
    en: () => 'First order price must be > 0, please check configuration',
  },
  'margin.validation.amount': {
    category: 'USER',
    zh: () => '补仓金额必须大于 0，请检查配置',
    en: () => 'Margin replenish amount must be > 0, please check configuration',
  },
  'cancel.validation.accountIdx': {
    category: 'USER',
    zh: () => '撤单账户索引无效，请检查配置',
    en: () => 'Cancel order account index invalid, please check configuration',
  },

  'account.sync.stopped': {
    category: 'API',
    zh: (p: { accountIdx: number; label?: string; count: number }) =>
      `账户 ${p.label || p.accountIdx} 同步连续失败 ${p.count} 次，已自动停止监控`,
    en: (p) => `Account ${p.label || p.accountIdx} sync failed ${p.count} consecutive times, monitoring auto-stopped`,
  },
  'system.monitoring.start': {
    zh: (p: { count: number; groups: number }) =>
      `开始监控 ${p.count} 个账户（${p.groups} 个交易所分组）`,
    en: (p) => `Starting monitoring for ${p.count} accounts (${p.groups} exchange groups)`,
  },

  'ws.connect.restored': {
    zh: (p: { wsType: string; attempts: number }) =>
      `WS ${p.wsType} 重连成功（第${p.attempts}次重连后）`,
    en: (p) => `WS ${p.wsType} reconnected (after ${p.attempts} attempts)`,
  },
  'ws.disconnect.normal': {
    zh: () => 'WebSocket 连接断开（正常网络波动），马上自动重连',
    en: () => 'WebSocket disconnected (normal network fluctuation), auto-reconnecting',
  },
  'ws.disconnected': {
    zh: (p: { wsType: string; code: number; reason: string; delay?: number; attempt?: number; max?: number }) =>
      p.delay != null
        ? `WS ${p.wsType} 断开 (code: ${p.code})，${p.delay}s 后重连 (${p.attempt}/${p.max})`
        : `WS ${p.wsType} 断开 (code: ${p.code}, reason: ${p.reason || '无'})`,
    en: (p) =>
      p.delay != null
        ? `WS ${p.wsType} disconnected (code: ${p.code}), reconnecting in ${p.delay}s (${p.attempt}/${p.max})`
        : `WS ${p.wsType} disconnected (code: ${p.code}, reason: ${p.reason || '(none)'})`,
  },
  'ws.connect.error': {
    zh: (p: { wsType: string; msg: string }) =>
      `OKX WebSocket ${p.wsType} 连接错误: ${p.msg}`,
    en: (p) => `OKX WebSocket ${p.wsType} connection error: ${p.msg}`,
  },
  'ws.connect.exception': {
    zh: (p: { wsType: string; code: number; msg: string }) =>
      `WS ${p.wsType} 异常 (${p.code}: ${p.msg || WSErrorZh[p.code] || '未知错误'})，自动重连中...`,
    en: (p) => `WS ${p.wsType} exception (${p.code}: ${p.msg || WSErrorEn[p.code] || 'Unknown error'}), auto-reconnecting...`,
  },
  'ws.login.retry': {
    zh: (p: { wsType: string; code: number; msg: string; current: number; max: number }) =>
      `WS ${p.wsType} 登录失败 (${p.code}: ${p.msg || WSErrorZh[p.code] || '未知错误'})，自动重连中... (${p.current}/${p.max})`,
    en: (p) => `WS ${p.wsType} login failed (${p.code}: ${p.msg || WSErrorEn[p.code] || 'Unknown error'}), auto-reconnecting... (${p.current}/${p.max})`,
  },
  'ws.login.maxRetries': {
    zh: (p: { wsType: string; code: number; msg: string }) =>
      `连续3次WS ${p.wsType} 登录失败 (${p.code}: ${p.msg || WSErrorZh[p.code] || '未知错误'})，已停止自动重连。请检查账户密钥或点击"重新连接"按钮重试`,
    en: (p) => `WS ${p.wsType} login failed ${p.current || 3} times (${p.code}: ${p.msg || WSErrorEn[p.code] || 'Unknown error'}), auto-reconnect stopped. Please check credentials or click "Reconnect"`,
  },
  'ws.login.timeout': {
    zh: (p: { wsType: string; timeout: number; current: number; max: number }) =>
      `WS ${p.wsType} 登录超时 (${p.timeout}秒内未收到响应)，自动重连中... (${p.current}/${p.max})`,
    en: (p) => `WS ${p.wsType} login timeout (no response within ${p.timeout}s), auto-reconnecting... (${p.current}/${p.max})`,
  },
  'ws.login.timeout.maxRetries': {
    zh: (p: { wsType: string }) =>
      `连续3次WS ${p.wsType} 登录超时，已停止自动重连。请检查网络或密钥配置，或点击"重新连接"按钮重试`,
    en: (p) => `WS ${p.wsType} login timeout after 3 attempts, auto-reconnect stopped. Please check network or click "Reconnect"`,
  },
  'ws.auth.passphrase': {
    category: 'USER',
    zh: (p: { wsType: string; passInfo: string }) =>
      `WS ${p.wsType} 认证失败 (Passphrase可能不正确)。当前passphrase: ${p.passInfo}`,
    en: (p) => `WS ${p.wsType} auth failed (Passphrase may be incorrect). Current passphrase: ${p.passInfo}`,
  },
  'ws.reconnect.maxAttempts': {
    zh: (p: { wsType: string; max: number }) =>
      `WS ${p.wsType} 已重连 ${p.max} 次均失败，永久停止重连。请检查网络或 VPN 后手动重连`,
    en: (p) => `WS ${p.wsType} failed to reconnect after ${p.max} attempts, permanently stopped. Please check network/VPN and reconnect manually`,
  },

  'account.init.timeSync': {
    zh: (p: { accountIdx: number; label?: string }) =>
      `账户 ${p.label || p.accountIdx} 正在进行服务器时间预同步...`,
    en: (p) => `Account ${p.label || p.accountIdx} is pre-syncing server time...`,
  },
  'account.init.timeSyncTimeout': {
    zh: (p: { accountIdx: number; label?: string }) =>
      `账户 ${p.label || p.accountIdx} 时间同步失败或超时 (15s)，将使用本地时间偏移`,
    en: (p) => `Account ${p.label || p.accountIdx} time sync failed/timed out (15s), will use local time offset`,
  },
  'account.init.timeSyncOk': {
    zh: (p: { accountIdx: number; label?: string }) =>
      `账户 ${p.label || p.accountIdx} 时间同步完成`,
    en: (p) => `Account ${p.label || p.accountIdx} time sync completed`,
  },
  'account.init.apiTest': {
    zh: (p: { accountIdx: number; label?: string }) =>
      `账户 ${p.label || p.accountIdx} 正在进行 API 连通性测试 (查询余额)...`,
    en: (p) => `Account ${p.label || p.accountIdx} is running API connectivity test (balance query)...`,
  },
  'account.init.apiTestFail': {
    category: 'API',
    zh: (p: { accountIdx: number; label?: string }) =>
      `账户 ${p.label || p.accountIdx} API 连接测试失败: getAccountBalance 返回 null`,
    en: (p) => `Account ${p.label || p.accountIdx} API test failed: getAccountBalance returned null`,
  },
  'account.init.apiTestOk': {
    zh: (p: { accountIdx: number; label?: string }) =>
      `账户 ${p.label || p.accountIdx} API 测试成功`,
    en: (p) => `Account ${p.label || p.accountIdx} API test OK`,
  },
  'account.init.fatal': {
    category: 'SYSTEM',
    zh: (p: { accountIdx: number; label?: string; msg: string }) =>
      `账户 ${p.label || p.accountIdx} 初始化过程中发生未捕获异常: ${p.msg}`,
    en: (p) => `Account ${p.label || p.accountIdx} unhandled exception during initialization: ${p.msg}`,
  },
  'account.monitoring.started': {
    zh: (p: { accountIdx: number; label?: string; intervalMs: number }) =>
      `账户 ${p.label || p.accountIdx} 监控已启动，刷新间隔：${p.intervalMs}ms`,
    en: (p) => `Account ${p.label || p.accountIdx} monitoring started, refresh interval: ${p.intervalMs}ms`,
  },

  'system.power.suspend': {
    zh: () => '系统休眠，标记 WS 连接待重连',
    en: () => 'System suspended, marking WS connections for reconnection',
  },
  'system.power.resume.start': {
    zh: () => '系统唤醒，开始重连所有 WS',
    en: () => 'System resumed, reconnecting all WS',
  },
  'system.power.resume.duplicate': {
    zh: () => '系统唤醒重连正在进行中，跳过重复请求',
    en: () => 'System resume reconnection already in progress, skipping duplicate request',
  },
  'system.power.resume.noWsManager': {
    zh: () => 'WS Manager 未初始化，跳过重连',
    en: () => 'WS Manager not initialized, skipping reconnection',
  },
  'system.power.resume.waitNetwork': {
    zh: () => '等待网络恢复（2秒）...',
    en: () => 'Waiting for network recovery (2s)...',
  },
  'system.power.resume.syncTime': {
    zh: () => '重新同步时间戳...',
    en: () => 'Re-syncing timestamps...',
  },
  'system.power.resume.timeSyncFailed': {
    zh: (p: { accountIdx: number; label?: string; msg: string }) =>
      `账户 ${p.label || p.accountIdx} 时间戳同步失败: ${p.msg}`,
    en: (p) => `Account ${p.label || p.accountIdx} timestamp sync failed: ${p.msg}`,
  },
  'system.power.resume.refreshOrders': {
    zh: () => '刷新订单缓存...',
    en: () => 'Refreshing order cache...',
  },
  'system.power.resume.complete': {
    zh: () => '系统唤醒重连完成',
    en: () => 'System resume reconnection complete',
  },
  'system.power.resume.failed': {
    zh: (p: { msg: string }) => `系统唤醒重连失败: ${p.msg}`,
    en: (p) => `System resume reconnection failed: ${p.msg}`,
  },
  'system.power.init': {
    zh: () => '电源监控桥接已初始化（Electron 模式）',
    en: () => 'Power monitor bridge initialized (Electron mode)',
  },
  'system.db.locked': {
    zh: () => '数据库被锁定，请稍后重试或检查是否有其他进程占用。',
    en: () => 'Database is locked, please retry or check for other process locks.',
  },
  'system.db.initFailed': {
    zh: (p: { msg: string }) => `数据库初始化失败: ${p.msg}`,
    en: (p) => `Database initialization failed: ${p.msg}`,
  },
  'system.ws.highLoad': {
    zh: (p: { count: number }) => `高负载: 正在刷新 ${p.count} 条消息`,
    en: (p) => `High load: flushing ${p.count} messages`,
  },
  'system.ws.monitorStartFailed': {
    zh: (p: { idx: number; label?: string; msg: string }) => `账户 ${p.label || p.idx} 监控启动失败: ${p.msg}`,
    en: (p) => `Account ${p.label || p.idx} monitoring start failed: ${p.msg}`,
  },
  'system.ws.monitorSkipped': {
    zh: (p: { idx: number; label?: string; exchange: string; reason: string }) =>
      `账户 ${p.label || p.idx} (${p.exchange}) 跳过监控: ${p.reason}`,
    en: (p) => `Account ${p.label || p.idx} (${p.exchange}) skipped monitoring: ${p.reason}`,
  },
  'system.ws.startException': {
    zh: (p: { msg: string }) => `账户监控启动异常: ${p.msg}`,
    en: (p) => `Account monitoring start exception: ${p.msg}`,
  },
  'account.sync.error': {
    category: 'API',
    zh: (p: { accountIdx: number; label?: string; failCount: number; msg: string }) =>
      `账户 ${p.label || p.accountIdx} 同步异常 (${p.failCount}/5): ${p.msg}`,
    en: (p) => `Account ${p.label || p.accountIdx} sync error (${p.failCount}/5): ${p.msg}`,
  },
  'account.sync.authFailure': {
    category: 'API',
    zh: (p: { accountIdx: number; label?: string }) => `账户 ${p.label || p.accountIdx} 认证失败，已清除陈旧数据`,
    en: (p) => `Account ${p.label || p.accountIdx} auth failed, stale data cleared`,
  },
  'account.sync.emptyResult': {
    zh: () => '增量同步返回空结果，可能网络异常，保留现有订单数据',
    en: () => 'Incremental sync returned empty result, possible network issue, preserving existing orders',
  },
  'account.sync.orders.silentSkip.notMonitored': {
    zh: (p: { accountIdx: number; activeCount: number }) => `[DEBUG] syncAccountOrders 跳过: 账户#${p.accountIdx} 不在 activeMonitors 中 (活跃=${p.activeCount})`,
    en: (p) => `[DEBUG] syncAccountOrders skip: account#${p.accountIdx} not in activeMonitors (active=${p.activeCount})`,
  },
  'account.sync.orders.cacheMissing': {
    zh: (p: { accountIdx: number }) => `[DEBUG] ORDERS_CACHE 未找到或缺少 broadcastSyncSignal, 账户#${p.accountIdx}`,
    en: (p) => `[DEBUG] ORDERS_CACHE not found or missing broadcastSyncSignal, account#${p.accountIdx}`,
  },
  'account.sync.orders.aborted.monitorStopped': {
    zh: (p: { accountIdx: number }) => `[DEBUG] 同步中止: 账户#${p.accountIdx} 监控已停止`,
    en: (p) => `[DEBUG] Sync aborted: account#${p.accountIdx} monitor stopped`,
  },
  'config.saveFailed': {
    category: 'SYSTEM',
    zh: (p: { msg: string }) => `保存配置失败: ${p.msg}`,
    en: (p) => `Config save failed: ${p.msg}`,
  },
  'config.dpapi.fallback': {
    zh: () => '非 Windows 系统，DPAPI 降级为 AES-256 加密',
    en: () => 'Non-Windows system, DPAPI downgraded to AES-256',
  },

  'system.bootstrap.migrationSaveFailed': {
    zh: (p: { msg: string }) =>
      `保存迁移后的配置失败（配置可能在内存中已更新但未持久化）: ${p.msg}`,
    en: (p) => `Failed to save migrated config (may be updated in memory but not persisted): ${p.msg}`,
  },
  'system.bootstrap.viteFailed': {
    zh: (p: { msg: string }) => `Vite 启动失败: ${p.msg}`,
    en: (p) => `Vite startup failed: ${p.msg}`,
  },
  'system.bootstrap.cachePreloadFailed': {
    zh: (p: { msg: string }) => `订单缓存预热失败: ${p.msg}`,
    en: (p) => `Order cache preload failed: ${p.msg}`,
  },
  'system.bootstrap.backgroundTaskFailed': {
    zh: (p: { msg: string }) => `后台任务启动失败: ${p.msg}`,
    en: (p) => `Background task startup failed: ${p.msg}`,
  },
  'system.bootstrap.cachePreloadRetry': {
    zh: (p: { retryCount: number; delayMs: number; msg: string }) =>
      `订单缓存预热失败，第 ${p.retryCount} 次重试（${p.delayMs}ms 后）：${p.msg}`,
    en: (p) => `Order cache preload failed, retry ${p.retryCount} (after ${p.delayMs}ms): ${p.msg}`,
  },
  'system.bootstrap.cachePreloadExhausted': {
    zh: (p: { max: number; msg: string }) =>
      `订单缓存预热失败，已重试 ${p.max} 次：${p.msg}`,
    en: (p) => `Order cache preload failed after ${p.max} retries: ${p.msg}`,
  },
  'server.config.received': {
    zh: (p: { body: string }) => `收到 POST /api/config，内容: ${p.body}...`,
    en: (p: { body: string }) => `POST /api/config — body: ${p.body}...`,
  },
  'server.config.saved': {
    zh: (p: { cfg: string }) => `配置已保存，新配置: ${p.cfg}...`,
    en: (p: { cfg: string }) => `Config saved — new config: ${p.cfg}...`,
  },
  'diy.jsonParseFailed': {
    zh: (p: { context: string; msg: string; raw: string }) =>
      `[JSON] ${p.context} parse failed: ${p.msg}; raw=${p.raw}`,
    en: (p) => `[JSON] ${p.context} parse failed: ${p.msg}; raw=${p.raw}`,
  },
  'diy.tickException': {
    zh: (p: { msg: string }) => `Tick 执行异常: ${p.msg}`,
    en: (p) => `Tick execution exception: ${p.msg}`,
  },
  'diy.saveFailed': {
    zh: (p: { msg: string }) => `保存策略数据失败: ${p.msg}，将在下次窗口重试`,
    en: (p) => `Save strategy data failed: ${p.msg}, will retry next window`,
  },
  'webhook.bodyEmpty': {
    category: 'USER',
    zh: () => '请求失败: 消息体内容为空',
    en: () => 'Request failed: empty body',
  },
  'webhook.jsonParseFailed': {
    category: 'USER',
    zh: (p: { raw: string }) => `JSON 解析失败! 原始内容: ${p.raw}`,
    en: (p) => `JSON parse failed! Raw: ${p.raw}`,
  },
  'webhook.noStrategyId': {
    zh: () => '丢弃请求: 字段中未包含 strategyId',
    en: () => 'Request discarded: strategyId not found in payload',
  },
  'webhook.strategyNotFound': {
    zh: (p: { id: string }) => `策略定位失败: 数据库中不存在 ID 为 [${p.id}] 的策略`,
    en: (p) => `Strategy not found: ID [${p.id}] does not exist in database`,
  },
  'webhook.secretMismatch': {
    category: 'USER',
    zh: (p: { name: string }) => `密钥验证失败! 策略: [${p.name}]`,
    en: (p) => `Secret verification failed! Strategy: [${p.name}]`,
  },
  'webhook.noSecret': {
    category: 'USER',
    zh: (p: { strategyId: string; name: string }) =>
      `Webhook 未设置密钥，存在安全风险! 策略: [${p.name}] (ID: ${p.strategyId})`,
    en: (p) =>
      `Webhook has no secret set, security risk! Strategy: [${p.name}] (ID: ${p.strategyId})`,
  },

  'ft.signalReceived': {
    zh: (p: { pair: string }) => `收到入场信号: ${p.pair}`,
    en: (p: { pair: string }) => `Entry signal received: ${p.pair}`,
  },
  'ft.signalExecuted': {
    zh: (p: { event: string; pair: string }) =>
      `Freqtrade 信号已执行: ${p.event} ${p.pair}`,
    en: (p) => `Freqtrade signal executed: ${p.event} ${p.pair}`,
  },
  'ft.signalFailed': {
    category: 'API',
    zh: (p: { event: string; pair: string; error: string }) =>
      `Freqtrade 信号执行失败: ${p.event} ${p.pair} - ${p.error}`,
    en: (p) => `Freqtrade signal execution failed: ${p.event} ${p.pair} - ${p.error}`,
  },
  'ft.strategyNotFound': {
    zh: (p: { id: string }) =>
      `Freqtrade 策略未找到: ${p.id}`,
    en: (p) => `Freqtrade strategy not found: ${p.id}`,
  },
  'ft.noActionConfig': {
    zh: (p: { event: string; strategyId: string }) =>
      `Freqtrade 策略 ${p.strategyId} 无 ${p.event} 对应的动作配置`,
    en: (p) => `Freqtrade strategy ${p.strategyId} has no action config for ${p.event}`,
  },

  'action.stop.signal': {
    zh: (p: { op: string }) => `收到停止信号，中止后续${p.op}操作`,
    en: (p: { op: string }) => `Stop signal received, aborting subsequent ${tOp(p.op)} operations`,
  },
  'action.complete': {
    zh: (p: { op: string; success: number; fail: number }) =>
      `${p.op}完成, 成功: ${p.success}, 失败: ${p.fail}`,
    en: (p: { op: string; success: number; fail: number }) =>
      `${tOp(p.op)} completed, success: ${p.success}, fail: ${p.fail}`,
  },
  'action.complete.stopped': {
    zh: (p: { op: string; success: number; fail: number }) =>
      `${p.op}完成, 成功: ${p.success}, 失败: ${p.fail} (用户中止)`,
    en: (p: { op: string; success: number; fail: number }) =>
      `${tOp(p.op)} completed, success: ${p.success}, fail: ${p.fail} (user stopped)`,
  },
  'action.exception': {
    zh: (p: { msg: string }) => `执行异常: ${p.msg}`,
    en: (p) => `Execution exception: ${p.msg}`,
  },
  'action.duplicate.batch': {
    zh: (p: { type: string }) => `检测到重复${p.type}批次，已忽略`,
    en: (p) => `Duplicate ${p.type} batch detected, ignored`,
  },

  'amend.no.orders.found': {
    zh: (p: { ordType?: string }) => `未找到符合条件的${p.ordType || ''} 订单`.trim(),
    en: (p: { ordType?: string }) => {
      const typeEn = (DESC_VALUE_EN[p.ordType || ''] || p.ordType || '');
      return `No matching ${typeEn} orders found`.trim();
    },
  },
  'amend.sim.noOrders': {
    zh: (p: { ordType?: string }) => `[模拟模式] 未找到符合条件的 ${p.ordType || ''} 订单，无法进行模拟`,
    en: (p: { ordType?: string }) => {
      const typeEn = DESC_VALUE_EN[p.ordType || ''] || p.ordType || '';
      return `[Sim mode] No matching ${typeEn} orders found, cannot simulate`;
    },
  },
  'amend.query.failed': {
    category: 'API',
    zh: (p: { instId: string; msg: string }) =>
      `查询指定交易对 ${p.instId} 订单失败 (可能该交易对不存在): ${p.msg}`,
    en: (p) => `Query orders for ${p.instId} failed (may not exist): ${p.msg}`,
  },
  'amend.remote.orders.matched': {
    zh: (p: { remote: number; type: string; remaining: number }) =>
      `从远程获取了 ${p.remote} 个订单，匹配 ${p.type} 后余 ${p.remaining} 个`,
    en: (p) => `Fetched ${p.remote} orders from remote, ${p.remaining} remaining after ${p.type} filter`,
  },
  'cancel.no.orders.found': {
    zh: () => '未找到符合条件的挂单',
    en: () => 'No matching pending orders found',
  },
  'cancel.refresh.start': {
    zh: (p: { instId: string }) => `正在刷新交易所订单（交易对: ${p.instId}）`,
    en: (p) => `Refreshing exchange orders (instId: ${p.instId})`,
  },
  'cancel.refresh.result': {
    zh: (p: { count: number; instId: string }) => `交易所返回 ${p.count} 个订单（交易对: ${p.instId}）`,
    en: (p) => `Exchange returned ${p.count} orders (instId: ${p.instId})`,
  },
  'cancel.local.orders': {
    zh: (p: { count: number; instId: string }) => `本地缓存 ${p.count} 个符合条件的订单（交易对: ${p.instId}）`,
    en: (p) => `Local cache has ${p.count} matching orders (instId: ${p.instId})`,
  },
  'cancel.sim.noOrders': {
    zh: () => '[模拟模式] 未找到符合条件的挂单，无法进行模拟',
    en: () => '[Sim mode] No matching pending orders found, cannot simulate',
  },
  'cancel.query.failed': {
    category: 'API',
    zh: (p: { instId: string; msg: string }) =>
      `查询指定交易对 ${p.instId} 订单失败 (可能该交易对不存在): ${p.msg}`,
    en: (p) => `Query orders for ${p.instId} failed (may not exist): ${p.msg}`,
  },

  'task.start.failed.noApiKey': {
    zh: () => '启动失败: 未找到有效 API 密钥',
    en: () => 'Start failed: no valid API key found',
  },
  'task.start.begin': {
    zh: (p: { type: string }) => {
      const typeMap: Record<string, string> = { 'QuickTrade': '极速下单' };
      return `开始执行一次性${typeMap[p.type] || p.type}任务...`;
    },
    en: (p: { type: string }) => {
      const typeMap: Record<string, string> = { 'QuickTrade': 'Quick Trade' };
      return `Starting one-time ${typeMap[p.type] || p.type} task...`;
    },
  },
  'task.complete': {
    zh: (p: { type: string }) => {
      const typeMap: Record<string, string> = { 'QuickTrade': '极速下单' };
      return `一次性${typeMap[p.type] || p.type}任务执行完毕。`;
    },
    en: (p: { type: string }) => {
      const typeMap: Record<string, string> = { 'QuickTrade': 'Quick Trade' };
      return `One-time ${typeMap[p.type] || p.type} task completed.`;
    },
  },
  'task.exception': {
    zh: (p: { msg: string }) => `执行异常: ${p.msg}`,
    en: (p) => `Execution exception: ${p.msg}`,
  },

  'diy.dateChanged': {
    zh: () => '检测到日期变更，正在重置所有 DIY 策略的每日执行计数...',
    en: () => 'Date change detected, resetting daily execution counters for all DIY strategies...',
  },
  'diy.strategy.init': {
    zh: (p: { tzLabel: string; now: string }) =>
      `DIY 引擎初始化成功。当前使用: ${p.tzLabel}，当前时间: ${p.now}`,
    en: (p: { tzLabel: string; now: string }) =>
      `DIY engine initialized. Timezone: ${p.tzLabel.replace('系统时区', 'System TZ').replace('北京时间', 'Beijing Time')}, current time: ${p.now}`,
  },
  'diy.action.unknown': {
    category: 'USER',
    zh: (p: { type: string }) => `未知的动作类型: ${p.type}`,
    en: (p) => `Unknown action type: ${p.type}`,
  },
  'diy.action.noInstId': {
    category: 'USER',
    zh: (p: { configId?: string; triggeredInstId?: string }) =>
      `下单动作缺少交易对（配置与条件触发均未指定），已跳过${p.configId ? ` [${p.configId}]` : ''}`,
    en: (p) =>
      `Place order action missing instId (neither config nor condition trigger specified), skipped${p.configId ? ` [${p.configId}]` : ''}`,
  },
  'diy.broadcast.failed': {
    zh: (p: { msg: string }) => `广播策略状态失败: ${p.msg}`,
    en: (p) => `Broadcast strategy status failed: ${p.msg}`,
  },
  'diy.tv.unmatched': {
    category: 'USER',
    zh: (p: { name: string; failed: string }) =>
      `[${p.name}] Webhook信号已到达但未触发动作: 未通过条件 [${p.failed}] (全部条件需同时满足)`,
    en: (p) =>
      `[${p.name}] Webhook signal received but not triggered: condition [${p.failed}] not met (all required)`,
  },
  'diy.email.failed': {
    zh: (p: { msg: string }) => `发送 Email 失败: ${p.msg}`,
    en: (p) => `Email send failed: ${p.msg}`,
  },
  'diy.step.skipped': {
    zh: () => '-> [步骤跳过] Email 通知缺少目标地址',
    en: () => '-> [Step skipped] Email notification missing target address',
  },
  'diy.flow.conditionsMet': {
    zh: (p: { name: string; count: number }) =>
      `策略 "${p.name}" 条件已满足, 准备按序执行 ${p.count} 个动作...`,
    en: (p) =>
      `Strategy "${p.name}" conditions met, executing ${p.count} action(s)...`,
  },
  'diy.flow.stepTrigger': {
    zh: (p: { typeLabel: string; target: string }) =>
      `-> [步骤执行] 触发 [${p.typeLabel}]: ${p.target}`,
    en: (p: { typeLabel: string; target: string }) =>
      `-> [Step] Trigger [${translateDiyActionType(p.typeLabel)}]: ${p.target}`,
  },
  'diy.flow.allDone': {
    zh: () => '已完成全部动作响应',
    en: () => 'All action responses completed',
  },
  'diy.flow.stopped': {
    zh: (p: { name: string }) =>
      `策略 "${p.name}" 在动作执行中被停止，终止后续动作`,
    en: (p) =>
      `Strategy "${p.name}" stopped during execution, aborting remaining actions`,
  },
  'diy.flow.actionFailed': {
    zh: (p: { typeLabel: string; i: number; total: number; msg: string }) =>
      `执行动作 [${p.typeLabel}] (#${p.i}/${p.total}) 失败: ${p.msg}`,
    en: (p) =>
      `Action [${p.typeLabel}] (#${p.i}/${p.total}) failed: ${p.msg}`,
  },
  'diy.flow.riskSkip': {
    zh: () => '-> [步骤跳过] 未发现明显风险仓位 (距离爆仓值 > 2000 USDT)',
    en: () => '-> [Step skipped] No significant risk position found (distance to liquidation > 2000 USDT)',
  },
  'diy.flow.stopStrategy': {
    zh: (p: { name: string }) => `-> [步骤执行] 触发 [停止策略]: ${p.name}`,
    en: (p) => `-> [Step] Trigger [Stop Strategy]: ${DESC_VALUE_EN[p.name] || p.name}`,
  },
  'diy.flow.stoppedN': {
    zh: (p: { count: number }) => `-> [动作结果] 已停止 ${p.count} 个 DIY 策略`,
    en: (p) => `-> [Result] Stopped ${p.count} DIY strategies`,
  },
  'diy.flow.sendStop': {
    zh: (p: { module: string; cfg: string }) =>
      `-> [动作执行] 已向模块 ${p.module} 发送停止指令: ${p.cfg}`,
    en: (p) =>
      `-> [Action] Sent stop command to module ${p.module}: ${p.cfg}`,
  },
  'diy.flow.sendEmail': {
    zh: (p: { email: string }) => `-> [步骤执行] 正在发送 Email 通知至: ${p.email}`,
    en: (p) => `-> [Step] Sending email notification to: ${p.email}`,
  },
  'diy.flow.sendPc': {
    zh: (p: { strategy: string }) => `-> [步骤执行] 已发送 PC 系统通知（Windows 通知）: 策略【${p.strategy}】`,
    en: (p) => `-> [Step] PC system notification sent (Windows): strategy [${p.strategy}]`,
  },
  'diy.flow.sendPcFallback': {
    zh: (p: { title: string; body: string }) =>
      `-> [步骤执行] [非 Electron 环境] PC 通知降级输出\n标题: ${p.title}\n内容: ${p.body}`,
    en: (p) => `-> [Step] [Non-Electron] PC notification fallback\nTitle: ${p.title}\nBody: ${p.body}`,
  },
  'diy.flow.sendTelegram': {
    zh: (p: { strategy: string }) => `-> [步骤执行] 已发送 Telegram 通知: 策略【${p.strategy}】`,
    en: (p) => `-> [Step] Telegram notification sent: strategy [${p.strategy}]`,
  },
  'diy.telegram.notBound': {
    zh: () => 'Telegram 未绑定，无法发送通知',
    en: () => 'Telegram not bound, cannot send notification',
  },
  'diy.telegram.failed': {
    zh: (p: { msg: string }) => `发送 Telegram 通知失败: ${p.msg}`,
    en: (p) => `Telegram notification failed: ${p.msg}`,
  },
  'diy.flow.notify': {
    zh: (p: { msg: string }) => `[通知] ${p.msg}`,
    en: (p) => `[Notify] ${p.msg}`,
  },
  'diy.flow.simTransfer': {
    zh: () => '[划转] 模拟划转执行...',
    en: () => '[Transfer] Simulated transfer executed...',
  },
  'diy.condition.eval': {
    zh: (p: { detail: string }) => translateCondEvalDetail(p.detail, 'zh'),
    en: (p: { detail: string }) => translateCondEvalDetail(p.detail, 'en'),
  },
  'diy.strategy.deleted': {
    zh: (p: { name: string }) => `策略 [${p.name}] 已从数据库删除，停止监控`,
    en: (p) => `Strategy [${p.name}] deleted from database, stopping monitoring`,
  },
  'diy.strategy.loadFailed': {
    zh: (p: { msg: string }) => `加载策略异常: ${p.msg}`,
    en: (p) => `Strategy load exception: ${p.msg}`,
  },
  'diy.strategy.notFound': {
    zh: (p: { id: string }) => `启动失败：未找到策略 ${p.id}`,
    en: (p) => `Start failed: strategy ${p.id} not found`,
  },
  'diy.strategy.conditionDeleted': {
    zh: (p: { name: string }) => `策略 [${p.name}] 的条件模板已被删除，无法运行`,
    en: (p) => `Strategy [${p.name}] condition template deleted, cannot run`,
  },
  'diy.strategy.started': {
    zh: (p: { name: string }) => `策略 [${p.name}] 已启动监控并预热数据`,
    en: (p) => `Strategy [${p.name}] started monitoring with preloaded data`,
  },
  'diy.strategy.stopped': {
    zh: (p: { name: string }) => `策略 [${p.name}] 已停止监控`,
    en: (p) => `Strategy [${p.name}] monitoring stopped`,
  },
  'diy.condition.tv.signal': {
    zh: (p: { id: string }) => `[信号] 收到 Webhook 信号，策略ID=${p.id}`,
    en: (p) => `[Signal] Webhook signal received, strategyID=${p.id}`,
  },
  'diy.condition.notReady': {
    zh: (p: { id: string }) => `[条件] 条件未满足 (数据未就绪) (策略ID=${p.id})`,
    en: (p) => `[Condition] Not met (data not ready) (strategyID=${p.id})`,
  },
  'diy.condition.notMet': {
    zh: (p: { id: string; reason: string }) =>
      `[条件] 条件不满足 (${p.reason}) (策略ID=${p.id})`,
    en: (p) => `[Condition] Not met (${p.reason}) (strategyID=${p.id})`,
  },
  'diy.dailyReset.onBoot': {
    zh: (p: { count: number }) => `启动时重置 ${p.count} 个策略的每日触发计数`,
    en: (p: { count: number }) => `Reset daily trigger count for ${p.count} strateg${p.count > 1 ? 'ies' : 'y'} on boot`,
  },
  'diy.restoreTriggered': {
    zh: (p: { count: number }) => `已恢复 ${p.count} 个交易对触发状态`,
    en: (p: { count: number }) => `Restored ${p.count} instrument trigger state${p.count > 1 ? 's' : ''}`,
  },
  'diy.restoreTriggered.failed': {
    zh: (p: { msg: string }) => `恢复触发状态失败: ${p.msg}`,
    en: (p: { msg: string }) => `Failed to restore trigger states: ${p.msg}`,
  },

  'account.monitor.notConfigured': {
    zh: (p: { accountIdx: number; label?: string }) => `账户 ${p.label || p.accountIdx} 未配置`,
    en: (p) => `Account ${p.label || p.accountIdx} not configured`,
  },
  'account.monitor.unsupported': {
    zh: (p: { accountIdx: number; label?: string; name: string; exchange: string }) =>
      `账户 ${p.label || p.accountIdx} (${p.name}) 交易平台 ${p.exchange} 暂不支持监控，跳过`,
    en: (p) => `Account ${p.label || p.accountIdx} (${p.name}) exchange ${p.exchange} not supported for monitoring, skipped`,
  },
  'account.monitor.missingCreds': {
    zh: (p: { accountIdx: number; label?: string; exchange: string }) =>
      `账户 ${p.label || p.accountIdx} 缺少凭证或解密失败 (Exchange: ${p.exchange})`,
    en: (p) => `Account ${p.label || p.accountIdx} missing credentials or decryption failed (Exchange: ${p.exchange})`,
  },
  'account.monitor.serviceLoadFailed': {
    category: 'SYSTEM',
    zh: (p: { accountIdx: number; label?: string; msg: string }) =>
      `账户 ${p.label || p.accountIdx} [币安] 服务层加载失败: ${p.msg}`,
    en: (p) => `Account ${p.label || p.accountIdx} [Binance] service layer load failed: ${p.msg}`,
  },
  'account.monitor.apiTestException': {
    category: 'API',
    zh: (p: { accountIdx: number; label?: string; msg: string }) =>
      `账户 ${p.label || p.accountIdx} API 测试异常: ${p.msg}`,
    en: (p) => `Account ${p.label || p.accountIdx} API test exception: ${p.msg}`,
  },
  'account.monitor.initStopped': {
    zh: (p: { accountIdx: number; label?: string }) => `账户 ${p.label || p.accountIdx} 在初始化期间被停止，跳过最终状态注入和轮询启动`,
    en: (p) => `Account ${p.label || p.accountIdx} stopped during init, skipping final state injection and polling`,
  },
  'account.monitor.stopped': {
    zh: (p: { accountIdx: number; label?: string }) => `账户 ${p.label || p.accountIdx} 监控已停止`,
    en: (p) => `Account ${p.label || p.accountIdx} monitoring stopped`,
  },
  'account.sync.skip.uninitialized': {
    zh: (p: { accountIdx: number; label?: string }) => `syncAccount: 账户 ${p.label || p.accountIdx} 未初始化，跳过同步`,
    en: (p) => `syncAccount: Account ${p.label || p.accountIdx} not initialized, skipping sync`,
  },
  'account.sync.orders.skip.uninitialized': {
    zh: (p: { accountIdx: number; label?: string }) => `syncAccountOrders: 账户 ${p.label || p.accountIdx} 未初始化，跳过同步`,
    en: (p) => `syncAccountOrders: Account ${p.label || p.accountIdx} not initialized, skipping sync`,
  },

  'bootstrap.port.check': {
    zh: (p: { port: number }) => `检测端口可用性（起始端口: ${p.port}）...`,
    en: (p) => `Checking port availability (starting port: ${p.port})...`,
  },
  'bootstrap.port.occupied': {
    zh: (p: { from: number; to: number }) => `端口 ${p.from} 已被占用，自动切换到 ${p.to}`,
    en: (p) => `Port ${p.from} is occupied, auto-switching to ${p.to}`,
  },
  'bootstrap.port.available': {
    zh: (p: { port: number }) => `端口 ${p.port} 可用`,
    en: (p) => `Port ${p.port} is available`,
  },
  'bootstrap.masterKey.wait': {
    zh: () => '主密钥未设置，等待用户解锁...',
    en: () => 'Master key not set, waiting for user unlock...',
  },
  'bootstrap.masterKey.loaded': {
    zh: () => '主密钥已加载，账户将被解密',
    en: () => 'Master key loaded, accounts will be decrypted',
  },
  'bootstrap.logService.init': {
    zh: () => '正在初始化日志服务...',
    en: () => 'Initializing log service...',
  },
  'bootstrap.accountId.migrated': {
    zh: () => '已为旧配置补充 account_id',
    en: () => 'account_id supplemented for legacy config',
  },
  'bootstrap.env.detected': {
    zh: (p: { env: string }) => `环境检测: NODE_ENV=${p.env}`,
    en: (p) => `Environment: NODE_ENV=${p.env}`,
  },
  'bootstrap.vite.start': {
    zh: () => '正在启动 Vite 中间件模式...',
    en: () => 'Starting Vite middleware mode...',
  },
  'bootstrap.vite.mounted': {
    zh: () => 'Vite 中间件及 SPA 路由已挂载',
    en: () => 'Vite middleware and SPA routes mounted',
  },
  'bootstrap.server.started': {
    zh: (p: { url: string }) => `服务启动成功: ${p.url}`,
    en: (p) => `Server started: ${p.url}`,
  },
  'bootstrap.webhook.url': {
    zh: (p: { url: string }) => `TradingView Webhook 地址: ${p.url}`,
    en: (p) => `TradingView Webhook URL: ${p.url}`,
  },
  'bootstrap.tunnel.fail': {
    zh: (p: { msg: string }) =>
      `Cloudflare Tunnel 自动启动失败（可手动启动）: ${p.msg}`,
    en: (p: { msg: string }) => {
      const enMsg = p.msg === '网络问题或 Cloudflare 服务端临时故障'
        ? 'network issue or Cloudflare server temporary outage'
        : p.msg.replace('进程退出，退出码:', 'exited with code:');
      return `Cloudflare Tunnel auto-start failed (can be started manually): ${enMsg}`;
    },
  },
  'bootstrap.tunnel.waiting': {
    zh: (p: { sec: number }) => `Cloudflare Tunnel 将在 ${p.sec} 秒后启动（等待网络就绪）...`,
    en: (p: { sec: number }) => `Cloudflare Tunnel will start in ${p.sec} seconds (waiting for network readiness)...`,
  },
  'bootstrap.tunnel.starting': {
    zh: (p: { bin: string; attempt?: number }) =>
      `正在启动 Cloudflare Tunnel (${p.bin})...${p.attempt != null ? ` (第${p.attempt}次尝试)` : ''}`,
    en: (p: { bin: string; attempt?: number }) =>
      `Starting Cloudflare Tunnel (${p.bin})...${p.attempt != null ? ` (attempt ${p.attempt})` : ''}`,
  },
  'bootstrap.tunnel.ready': {
    zh: (p: { url: string }) => `Cloudflare Tunnel 已就绪: ${p.url}`,
    en: (p: { url: string }) => `Cloudflare Tunnel is ready: ${p.url}`,
  },
  'bootstrap.tunnel.retry': {
    zh: (p: { attempt: number; max: number }) => `Cloudflare Tunnel 启动失败，5秒后重试 (${p.attempt}/${p.max})...`,
    en: (p: { attempt: number; max: number }) => `Cloudflare Tunnel startup failed, retrying in 5s (${p.attempt}/${p.max})...`,
  },
  'bootstrap.db.init': {
    zh: () => 'SQLite 数据库初始化成功。',
    en: () => 'SQLite database initialized.',
  },
  'bootstrap.db.tables': {
    zh: () => '数据库表已检查/创建。',
    en: () => 'Database tables checked/created.',
  },

  'margin.sim.transfer': {
    zh: (p: { mode: string; amt: number; dest: string }) =>
      `模拟${p.mode} ₮${p.amt} 至账户 ${p.dest}`,
    en: (p: { mode: string; amt: number; dest: string }) =>
      `Sim ${translateMarginMode(p.mode)} ₮${p.amt} to account ${translateMarginDest(p.dest)}`,
  },
  'margin.real.transfer.start': {
    zh: (p: { amt: number; dest: string }) =>
      `尝试从资金账户划转 ₮${p.amt} 至账户 ${p.dest}...`,
    en: (p: { amt: number; dest: string }) =>
      `Transferring ₮${p.amt} from funding to account ${translateMarginDest(p.dest)}...`,
  },
  'margin.transfer.success': {
    zh: () => '✅ 划转成功, 保证金已补充',
    en: () => '✅ Transfer successful, margin added',
  },
  'margin.transfer.fail.check': {
    zh: () => '❌ 划转失败, 请检查资金账户余额',
    en: () => '❌ Transfer failed, please check funding account balance',
  },
  'margin.transfer.fail.check2': {
    zh: () => '❌ 划转失败, 请检查资金账户余额或划转限制',
    en: () => '❌ Transfer failed, please check funding account balance or transfer limits',
  },
  'margin.real.redeem.start': {
    zh: (p: { amt: number }) => `从赚币赎回 ₮${p.amt}...`,
    en: (p: { amt: number }) => `Redeeming ₮${p.amt} from savings...`,
  },
  'margin.redeem.success': {
    zh: (p: { dest: string }) => `✅ 赎回成功, 准备划转至目标账户 ${p.dest}...`,
    en: (p: { dest: string }) => `✅ Redemption successful, transferring to ${translateMarginDest(p.dest)}...`,
  },
  'margin.redeem.fail': {
    zh: () => '❌ 赎回失败, 请检查赚币账户余额',
    en: () => '❌ Redemption failed, please check savings balance',
  },

  'trader.warn.queryFailed': {
    zh: () => '订单查询未成功，取消本次执行（避免重复下单风险）',
    en: () => 'Order query failed, canceling execution (to avoid duplicate orders)',
  },
  'trader.warn.noMarketPrice': {
    zh: () => '无法获取实时行情，将尝试使用填写的委托价作为基准',
    en: () => 'Unable to get market price, will try using configured order price as reference',
  },
  'trader.warn.noPositionSize': {
    zh: () => '公式引用了持仓量变量(s)，但未找到匹配的仓位数据',
    en: () => 'Formula references position size variable (s), but no matching position found',
  },
  'trader.warn.noSodUtc8': {
    zh: () => '公式引用了当日开盘价变量(s8)，但无法获取数据（仅合约交易对支持）',
    en: () => 'Formula references today open price variable (s8), but data unavailable (contracts only)',
  },
  'trader.warn.positionQueryFailed': {
    zh: () => '查询持仓量失败，公式中的 s 变量将无法使用',
    en: () => 'Failed to query position data, s variable in formula will be unavailable',
  },
  'trader.warn.noMarketPriceTpSl': {
    zh: () => '无法获取市场价，且未设置首单价格，将无法正确设置绝对价止盈止损',
    en: () => 'Cannot get market price and no first order price set; absolute TP/SL will be unavailable',
  },
  'trader.warn.intervalFormulaError': {
    zh: (p) => `第 ${p.num} 单下单间隔公式求值失败: ${p.formula} → ${p.error}`,
    en: (p) => `Order ${p.num} interval formula evaluation failed: ${p.formula} → ${p.error}`,
  },
  'trader.warn.sizeFormulaError': {
    zh: (p) => `第 ${p.num} 单委托数量公式求值失败: ${p.formula} → ${p.error}`,
    en: (p) => `Order ${p.num} quantity formula evaluation failed: ${p.formula} → ${p.error}`,
  },
  'trader.warn.noTickSz': {
    zh: (p) => `交易对 ${p.instId} 的最小变动价位（tickSz）未获取到，价格可能因 OKX 舍入规则不同而出现 1 tick 偏差`,
    en: (p) => `Tick size for ${p.instId} not available, prices may have 1-tick deviation due to OKX rounding differences`,
  },
  'bootstrap.shutdown.graceful': {
    zh: () => '正在优雅关闭...',
    en: () => 'Gracefully shutting down...',
  },
  'bootstrap.shutdown.sigterm': {
    zh: () => '收到 SIGTERM 信号，正在关闭...',
    en: () => 'Received SIGTERM signal, shutting down...',
  },
  'bootstrap.background.started': {
    zh: () => '后台任务已启动（订单缓存预热中）',
    en: () => 'Background jobs started (order cache preloading)',
  },
  'bootstrap.background.cacheDone': {
    zh: () => '订单缓存预热完成',
    en: () => 'Order cache preload complete',
  },
  'bootstrap.background.monitorStart': {
    zh: () => '正在启动账户监控...',
    en: () => 'Starting account monitoring...',
  },
  'bootstrap.background.waitMasterKey': {
    zh: () => '账户未启动，等待主密钥',
    en: () => 'Accounts not started, waiting for master key',
  },
  'bootstrap.autoStart.done': {
    zh: (p: { count: number }) => `已自动启动 ${p.count} 个策略`,
    en: (p: { count: number }) => `Auto-started ${p.count} strateg${p.count > 1 ? 'ies' : 'y'}`,
  },

  'route.account.loadFailed': {
    zh: (p: { msg: string }) => `加载账户列表失败: ${p.msg}`,
    en: (p) => `Failed to load account list: ${p.msg}`,
  },
  'route.account.reconnecting': {
    zh: (p: { name: string }) => `账户 ${p.name} 正在重新连接...`,
    en: (p) => `Account ${p.name} is reconnecting...`,
  },

  'instrument.loaded': {
    zh: (p: { count: number }) => `已从数据库加载 ${p.count} 个交易对。`,
    en: (p) => `Loaded ${p.count} instruments from database.`,
  },
  'instrument.loadFailed': {
    zh: (p: { msg: string }) => `从数据库加载失败: ${p.msg}`,
    en: (p) => `Failed to load from database: ${p.msg}`,
  },
  'instrument.cacheSaveFailed': {
    zh: (p: { msg: string }) => `后台异步保存本地交易对缓存文件失败: ${p.msg}`,
    en: (p) => `Async save of local instrument cache failed: ${p.msg}`,
  },
  'instrument.fetched': {
    zh: (p: { count: number }) => `已获取并存储 ${p.count} 个交易对。`,
    en: (p) => `Fetched and stored ${p.count} instruments.`,
  },
  'instrument.fetchFailed': {
    zh: (p: { msg: string }) => `获取交易对失败: ${p.msg}`,
    en: (p) => `Failed to fetch instruments: ${p.msg}`,
  },

  'account.balance.failed': {
    category: 'API',
    zh: (p: { exchange: string; label: string; msg: string }) =>
      `账户 ${p.label} 获取余额失败: ${p.msg}`,
    en: (p) => `Account ${p.label} balance fetch failed: ${translateApiError(p.msg)}`,
  },
  'account.positions.failed': {
    category: 'API',
    zh: (p: { exchange: string; label: string; msg: string }) =>
      `账户 ${p.label} 获取持仓失败: ${p.msg}`,
    en: (p) => `Account ${p.label} positions fetch failed: ${translateApiError(p.msg)}`,
  },
  'account.positionsHistory.failed': {
    category: 'API',
    zh: (p: { exchange: string; label: string; msg: string }) =>
      `账户 ${p.label} 获取历史仓位失败: ${p.msg}`,
    en: (p) => `Account ${p.label} positions history fetch failed: ${translateApiError(p.msg)}`,
  },
  'account.orders.failed': {
    category: 'API',
    zh: (p: { exchange: string; label: string; msg: string }) =>
      `账户 ${p.label} 获取挂单失败（可忽略，下次同步重试）: ${p.msg}`,
    en: (p) => `Account ${p.label} orders fetch failed (ignorable, retry on next sync): ${translateApiError(p.msg)}`,
  },
  'account.tpsl.failed': {
    category: 'API',
    zh: (p: { exchange: string; label: string; msg: string }) =>
      `账户 ${p.label} 获取止盈止损挂单失败: ${p.msg}`,
    en: (p) => `Account ${p.label} TP/SL orders fetch failed: ${translateApiError(p.msg)}`,
  },
  'account.market.failed': {
    category: 'API',
    zh: (p: { exchange: string; instId: string; msg: string }) =>
      `获取市场行情失败 ${p.instId}: ${p.msg}`,
    en: (p) => `Market price fetch failed ${p.instId}: ${p.msg}`,
  },
  'account.valuation.failed': {
    category: 'API',
    zh: (p: { exchange: string; label: string; msg: string }) =>
      `账户 ${p.label} 获取资产估值失败（可忽略，下次同步重试）: ${p.msg}`,
    en: (p) => `Account ${p.label} asset valuation failed (ignorable, will retry): ${p.msg}`,
  },
  'account.futures.valuation.failed': {
    category: 'API',
    zh: (p: { exchange: string; label: string; msg: string }) =>
      `账户 ${p.label} 获取合约资产估值失败（可忽略，下次同步重试）: ${p.msg}`,
    en: (p) => `Account ${p.label} futures valuation failed (ignorable, will retry): ${p.msg}`,
  },
  'account.risk.config.failed': {
    category: 'API',
    zh: (p: { label: string; msg: string; exchange?: string }) =>
      `账户 ${p.label} 获取合约风险配置失败（可忽略，下次同步重试）: ${p.msg}`,
    en: (p) => `Account ${p.label} futures risk config fetch failed (ignorable, will retry): ${p.msg}`,
  },
  'account.conditional.orders.failed': {
    category: 'API',
    zh: (p: { label: string; msg: string; exchange?: string }) =>
      `账户 ${p.label} 获取合约条件单列表失败（可忽略，下次同步重试）: ${p.msg}`,
    en: (p) => `Account ${p.label} conditional orders fetch failed (ignorable, will retry): ${p.msg}`,
  },
  'account.spot.orders.failed': {
    category: 'API',
    zh: (p: { label: string; msg: string; exchange?: string }) =>
      `账户 ${p.label} 获取现货挂单列表失败（可忽略，下次同步重试）: ${p.msg}`,
    en: (p) => `Account ${p.label} spot orders fetch failed (ignorable, will retry): ${p.msg}`,
  },
  'account.margin.info.failed': {
    category: 'API',
    zh: (p: { label: string; msg: string; exchange?: string }) =>
      `账户 ${p.label} 获取杠杆账户信息失败（可忽略，下次同步重试）: ${p.msg}`,
    en: (p) => `Account ${p.label} margin account info fetch failed (ignorable, will retry): ${p.msg}`,
  },
  'account.margin.orders.failed': {
    category: 'API',
    zh: (p: { label: string; msg: string; exchange?: string }) =>
      `账户 ${p.label} 获取杠杆挂单列表失败（可忽略，下次同步重试）: ${p.msg}`,
    en: (p) => `Account ${p.label} margin orders fetch failed (ignorable, will retry): ${p.msg}`,
  },
  'account.futures.position.failed': {
    category: 'API',
    zh: (p: { label: string; msg: string; exchange?: string }) =>
      `账户 ${p.label} 获取合约持仓失败（可忽略，下次同步重试）: ${p.msg}`,
    en: (p) => `Account ${p.label} futures position fetch failed (ignorable, will retry): ${p.msg}`,
  },
  'account.margin.position.failed': {
    category: 'API',
    zh: (p: { label: string; msg: string; exchange?: string }) =>
      `账户 ${p.label} 获取杠杆持仓失败（可忽略，下次同步重试）: ${p.msg}`,
    en: (p) => `Account ${p.label} margin position fetch failed (ignorable, will retry): ${p.msg}`,
  },
  'account.oco.preload.failed': {
    category: 'API',
    zh: (p: { label: string; msg: string; exchange?: string }) =>
      `账户 ${p.label} 预取 OCO/OTO 订单列表失败（可忽略，下次同步重试）: ${p.msg}`,
    en: (p) => `Account ${p.label} OCO/OTO preload failed (ignorable, will retry): ${p.msg}`,
  },
  'instrument.fetchFailed.timeout': {
    zh: () => '获取交易对失败: 网络连接超时，请检查网络',
    en: () => 'Failed to fetch instruments: Network timeout, please check connection',
  },
  'account.savings.failed': {
    category: 'API',
    zh: (p: { exchange: string; label: string; msg: string }) =>
      `账户 ${p.label} 获取理财余额失败: ${p.msg}`,
    en: (p) => `Account ${p.label} savings balance fetch failed: ${translateApiError(p.msg)}`,
  },
  'binance.spot.oto.unavailable': {
    zh: () => '[BINANCE] 现货/杠杆下单暂不支持与限价开仓单同时下达止盈止损单',
    en: () => '[BINANCE] Spot/Margin orders do not support TP/SL attached to limit opening orders',
  },
  'account.auth.failed': {
    category: 'API',
    zh: (p: { exchange: string; label: string; passInfo: string }) =>
      `账户 ${p.label} 认证失败 (Passphrase可能不正确)。当前Passphrase: ${p.passInfo}`,
    en: (p) => `Account ${p.label} auth failed (Passphrase may be incorrect). Current: ${p.passInfo}`,
  },
  'account.redeem.failed': {
    category: 'API',
    zh: (p: { exchange: string; label: string; msg: string }) =>
      `账户 ${p.label} 赎回理财失败: ${p.msg}`,
    en: (p) => `Account ${p.label} redeem savings failed: ${p.msg}`,
  },
  'account.transfer.failed': {
    category: 'API',
    zh: (p: { exchange: string; label: string; msg: string }) =>
      `账户 ${p.label} 转账失败: ${p.msg}`,
    en: (p) => `Account ${p.label} transfer failed: ${p.msg}`,
  },

  'ws.reconnect.marked': {
    zh: (p: { count: number }) => `已标记 ${p.count} 个账户的 WS 连接为待重连状态`,
    en: (p) => `Marked ${p.count} account WS connections for reconnection`,
  },
  'ws.reconnect.forceClosed': {
    zh: (p: { count: number }) => `已强制关闭 ${p.count} 个账户的 WS 连接`,
    en: (p) => `Force closed ${p.count} account WS connections`,
  },
  'ws.reconnect.starting': {
    zh: (p: { count: number }) => `开始重新连接 ${p.count} 个账户的 WS`,
    en: (p) => `Starting reconnection for ${p.count} accounts`,
  },
  'ws.reconnect.requested': {
    zh: () => 'WS 重连请求已发出',
    en: () => 'WS reconnection request sent',
  },
  'close.query.failed': {
    category: 'API',
    zh: (p: { instId: string; msg: string }) =>
      `查询指定交易对 ${p.instId} 持仓失败: ${p.msg}`,
    en: (p) => `Query positions for ${p.instId} failed: ${p.msg}`,
  },
  'close.no.positions': {
    zh: () => '未找到可平仓的持仓',
    en: () => 'No positions found to close',
  },
  'close.cancel.pending.failed': {
    zh: (p: { instId: string; msg: string }) =>
      `平仓并撤单失败 ${p.instId}: ${p.msg}`,
    en: (p: { instId: string; msg: string }) =>
      `Close-and-cancel-pending failed for ${p.instId}: ${p.msg}`,
  },
  'close.filter.result': {
    zh: (p: { count: number; mgnMode: string; posSide: string; uplFilter: string; uplRatioFilter: string }) =>
      `筛选结果: ${p.count}个持仓匹配 (模式=${p.mgnMode}, 方向=${p.posSide}, 收益额=${p.uplFilter}, 收益率=${p.uplRatioFilter})`,
    en: (p: { count: number; mgnMode: string; posSide: string; uplFilter: string; uplRatioFilter: string }) =>
      `Filter result: ${p.count} position(s) matched (Mode=${p.mgnMode}, Side=${p.posSide}, UPL=${p.uplFilter}, UPL%=${p.uplRatioFilter})`,
  },
  'close.position.sim': {
    zh: (p: { num: number; detail: string }) =>
      `模拟平仓 #${p.num}: ${p.detail}`,
    en: (p: { num: number; detail: string }) =>
      `Sim close #${p.num}: ${translateCloseDetail(p.detail)}`,
  },
  'close.position.ok': {
    zh: (p: { num: number; detail: string }) =>
      `✅ 平仓成功 #${p.num}: ${p.detail}`,
    en: (p: { num: number; detail: string }) =>
      `✅ Close OK #${p.num}: ${translateCloseDetail(p.detail)}`,
  },
  'close.position.fail': {
    category: 'API',
    zh: (p: { num: number; reason: string; params?: string }) =>
      `❌ 平仓失败 #${p.num}: ${p.reason}${p.params ? ', 传参: ' + p.params : ''}`,
    en: (p) => `❌ Close failed #${p.num}: ${p.reason}${p.params ? ', Params: ' + p.params : ''}`,
  },
  'close.position.exception': {
    zh: (p: { num: number; reason: string; params?: string }) =>
      `❌ 平仓异常 #${p.num}: ${p.reason}${p.params ? ', 传参: ' + p.params : ''}`,
    en: (p) => `❌ Close exception #${p.num}: ${p.reason}${p.params ? ', Params: ' + p.params : ''}`,
  },
  'close.reverse.ok': {
    zh: (p: { instId: string; dir: 'short' | 'long' }) =>
      `✅ ${p.instId} ${p.dir === 'short' ? '反手开空' : '反手开多'}`,
    en: (p) => `✅ ${p.instId} ${p.dir === 'short' ? 'Reverse Open Short' : 'Reverse Open Long'}`,
  },
  'close.reverse.fail': {
    zh: (p: { detail: string; reason: string }) =>
      `❌ 反手失败 ${p.detail}: ${p.reason}`,
    en: (p) => `❌ Reverse failed ${p.detail}: ${p.reason}`,
  },
  'webhook.strategy.notRunning': {
    zh: (p: { name: string }) =>
      `⚠️ Webhook信号触发，对应策略 [${p.name}] 未运行`,
    en: (p) => `⚠️ Webhook signal received but strategy [${p.name}] is not running`,
  },
  'webhook.internal.error': {
    zh: (p: { msg: string }) => `内部错误: ${p.msg}`,
    en: (p) => `Internal error: ${p.msg}`,
  },
  'email.send.success': {
    zh: (p: { id: string }) => `邮件发送成功: ${p.id}`,
    en: (p) => `Email sent successfully: ${p.id}`,
  },
  'email.send.failed': {
    zh: (p: { msg: string }) => `邮件发送失败: ${p.msg}`,
    en: (p) => `Email send failed: ${p.msg}`,
  },

  'order.placed': buildOrderResultTemplate('✅ 下单成功', '✅ Order placed'),
  'order.placed.fail': {
    category: 'API',
    zh: (p: { num: number; reason: string; params?: string }) =>
      `❌ 下单失败 #${p.num}: ${p.reason}${p.params ? ', 传参: ' + p.params : ''}`,
    en: (p) => `❌ Order failed #${p.num}: ${p.reason}${p.params ? ', Params: ' + p.params : ''}`,
  },
  'order.simulate': buildOrderResultTemplate('模拟下单', 'Sim order'),
  'amend.order.simulate': {
    zh: (p: { num: number; detail: string }) => `模拟改单 #${p.num}: ${p.detail}`,
    en: (p: { num: number; detail: string }) => `Sim amend #${p.num}: ${translateAmendDetail(p.detail)}`,
  },
  'order.exception': {
    zh: (p: { num: number; msg: string }) =>
      `❌ 下单异常 #${p.num}: ${p.msg}`,
    en: (p) => `❌ Order exception #${p.num}: ${p.msg}`,
  },
  'order.skipped': {
    zh: (p: { num: number; reason: string }) =>
      `跳过 #${p.num}: ${p.reason}`,
    en: (p) => `Skipped #${p.num}: ${p.reason}`,
  },
  'order.amend.ok': {
    zh: (p: { num: number; ordId: string; detail: string; linkage?: string }) =>
      `✅ 修改成功 #${p.num}${p.linkage || ''}: 订单ID=${p.ordId}, ${p.detail}`,
    en: (p: { num: number; ordId: string; detail: string; linkage?: string }) =>
      `✅ Amend OK #${p.num}${p.linkage || ''}: ID=${p.ordId}, ${translateAmendDetail(p.detail)}`,
  },
  'order.amend.fail': {
    category: 'API',
    zh: (p: { num: number; reason: string; params?: string }) =>
      `❌ 修改失败 #${p.num}: ${p.reason}${p.params ? ', 传参: ' + p.params : ''}`,
    en: (p) => `❌ Amend failed #${p.num}: ${p.reason}${p.params ? ', Params: ' + p.params : ''}`,
  },
  'order.cancel.ok': buildCancelResultTemplate('✅ 撤单成功', '✅ Cancel OK'),
  'order.cancel.sim': buildCancelResultTemplate('模拟撤单', 'Sim cancel'),
  'order.cancel.fail': {
    category: 'API',
    zh: (p: { num: number; reason: string; params?: string }) =>
      `❌ 撤单失败 #${p.num}: ${p.reason}${p.params ? ', 传参: ' + p.params : ''}`,
    en: (p) => `❌ Cancel failed #${p.num}: ${p.reason}${p.params ? ', Params: ' + p.params : ''}`,
  },
  'position.close.ok': {
    zh: (p: { num: number; detail: string }) =>
      `✅ 平仓成功 #${p.num}: ${p.detail}`,
    en: (p) => `✅ Close OK #${p.num}: ${p.detail}`,
  },
  'position.close.fail': {
    zh: (p: { num: number; reason: string; detail: string }) =>
      `❌ 平仓失败 #${p.num}: ${p.reason} | 详情: ${p.detail}`,
    en: (p) => `❌ Close failed #${p.num}: ${p.reason} | Details: ${p.detail}`,
  },
  'position.close.sim': {
    zh: (p: { num: number; detail: string }) =>
      `模拟平仓 #${p.num}: ${p.detail}`,
    en: (p) => `Sim close #${p.num}: ${p.detail}`,
  },
  'margin.transfer': {
    zh: (p: { mode: string; amt: number; dest: string }) =>
      `${p.mode} ₮${p.amt} 至账户 ${p.dest}...`,
    en: (p: { mode: string; amt: number; dest: string }) =>
      `${translateMarginMode(p.mode)} ₮${p.amt} to ${translateMarginDest(p.dest)}...`,
  },
  'margin.transfer.ok': {
    zh: (p: { label?: string }) =>
      `✅ 划转成功${p.label ? '至 ' + p.label : ''}, 保证金已补充`,
    en: (p) => `✅ Transfer OK${p.label ? ' to ' + p.label : ''}, margin replenished`,
  },
  'margin.transfer.fail': {
    category: 'API',
    zh: (p: { msg: string }) =>
      `❌ 划转失败, ${p.msg}`,
    en: (p) => `❌ Transfer failed, ${p.msg}`,
  },

  'field.triggerPx': {
    zh: (p: { px: number | string }) => `触发价=${p.px}`,
    en: (p) => `Trigger=${p.px}`,
  },
  'field.ordPx': {
    zh: (p: { px: number | string }) => `委托价=${p.px}`,
    en: (p) => `Price=${p.px}`,
  },
  'field.tp': {
    zh: (p: { margin: number | string }) => `止盈幅度=${p.margin}`,
    en: (p) => `TP spread=${p.margin}`,
  },
  'field.sl': {
    zh: (p: { margin: number | string }) => `止损幅度=${p.margin}`,
    en: (p) => `SL spread=${p.margin}`,
  },
  'field.chase': {
    zh: (p: { val: number | string }) => `价距=${p.val}`,
    en: (p) => `Chase=${p.val}`,
  },
  'field.callback': {
    zh: (p: { ratio: number | string; gap: number | string }) =>
      `回调幅度比例=${p.ratio}, 回调幅度价距=${p.gap}`,
    en: (p) => `Callback ratio=${p.ratio}, spread=${p.gap}`,
  },
  'field.activePx': {
    zh: (p: { px: number | string }) => `激活价格=${p.px}`,
    en: (p) => `Active=${p.px}`,
  },
  'field.sz': {
    zh: (p: { sz: number | string }) => `数量=${p.sz}`,
    en: (p) => `Sz=${p.sz}`,
  },
  'field.tpPx': {
    zh: (p: { px: number | string }) => `止盈=${p.px}`,
    en: (p) => `TP=${p.px}`,
  },
  'field.slPx': {
    zh: (p: { px: number | string }) => `止损=${p.px}`,
    en: (p) => `SL=${p.px}`,
  },

  'error.network.socket_hang_up': {
    zh: () => '网络连接波动，请求意外中断 (socket hang up)',
    en: () => 'Network fluctuation, request unexpectedly interrupted (socket hang up)',
  },
  'error.network.ECONNRESET': {
    zh: () => '连接被远端重置 (ECONNRESET)',
    en: () => 'Connection reset by remote peer (ECONNRESET)',
  },
  'error.network.ETIMEDOUT': {
    zh: () => '网络请求超时 (ETIMEDOUT)',
    en: () => 'Network request timed out (ETIMEDOUT)',
  },
  'error.network.ECONNREFUSED': {
    zh: () => '目标服务拒绝连接 (ECONNREFUSED)',
    en: () => 'Target service refused connection (ECONNREFUSED)',
  },
  'error.network.EHOSTUNREACH': {
    zh: () => '无法路由到目标主机 (EHOSTUNREACH)',
    en: () => 'Unable to route to target host (EHOSTUNREACH)',
  },
  'error.network.ENOTFOUND': {
    zh: () => '无法解析域名 (ENOTFOUND)',
    en: () => 'Unable to resolve domain name (ENOTFOUND)',
  },

  'telegram.bound': {
    zh: (p: { chatId: string }) => `Telegram 绑定成功 (chat_id: ${p.chatId})`,
    en: (p) => `Telegram bound (chat_id: ${p.chatId})`,
  },
  'telegram.tokenSaved': {
    zh: (p: { username: string }) => `Bot Token 已保存 (@${p.username})`,
    en: (p) => `Bot Token saved (@${p.username})`,
  },
  'telegram.sendFailed': {
    zh: (p: { msg: string }) => `Telegram 发送失败: ${p.msg}`,
    en: (p) => `Telegram send failed: ${p.msg}`,
  },
  'telegram.notBound': {
    zh: () => 'Telegram 未绑定，无法发送通知',
    en: () => 'Telegram not bound, cannot send notification',
  },

  'telegram.tokenInit': {
    zh: () => '已写入内置默认 Bot Token（DPAPI 加密）',
    en: () => 'Built-in default Bot Token written (DPAPI encrypted)',
  },
  'telegram.tokenInitFailed': {
    zh: (p: { msg: string }) => `默认 Token 初始化失败: ${p.msg}`,
    en: (p) => `Default Token init failed: ${p.msg}`,
  },
  'telegram.tokenDecryptFailed': {
    zh: (p: { msg: string }) => `Token 解密失败，将重置为内置默认 Token: ${p.msg}`,
    en: (p) => `Token decrypt failed, will reset to built-in default: ${p.msg}`,
  },
  'telegram.bindStart': {
    zh: (p: { code: string }) => `开始绑定，等待用户点击深链接 code=${p.code}`,
    en: (p) => `Binding started, waiting for user to open deep link code=${p.code}`,
  },
  'telegram.unbound': {
    zh: () => '已解绑 Telegram',
    en: () => 'Telegram unbound',
  },
  'telegram.pollTimeout': {
    zh: () => '绑定轮询超时，已自动取消',
    en: () => 'Binding poll timed out, auto cancelled',
  },
  'telegram.pollNoToken': {
    zh: () => '绑定轮询失败：无法获取 Bot Token',
    en: () => 'Binding poll failed: cannot get Bot Token',
  },
  'telegram.pollOffset': {
    zh: (p: { offset: number }) => `绑定轮询中... offset=${p.offset}`,
    en: (p) => `Binding poll running... offset=${p.offset}`,
  },
  'telegram.pollReceived': {
    zh: (p: { count: number }) => `轮询收到 ${p.count} 条更新`,
    en: (p) => `Poll received ${p.count} update(s)`,
  },
  'telegram.pollMessage': {
    zh: (p: { text: string; fromId: number | string }) => `收到消息: "${p.text}" from=${p.fromId}`,
    en: (p) => `Message received: "${p.text}" from=${p.fromId}`,
  },
  'telegram.getUpdatesError': {
    zh: (p: { detail: string }) => `getUpdates 返回错误: ${p.detail}`,
    en: (p) => `getUpdates returned error: ${p.detail}`,
  },
  'telegram.getUpdatesParseFailed': {
    zh: (p: { msg: string; data: string }) => `getUpdates 响应解析失败: ${p.msg}，原始数据前200字: ${p.data}`,
    en: (p) => `getUpdates response parse failed: ${p.msg}, raw data first 200 chars: ${p.data}`,
  },
  'telegram.getUpdatesNetworkError': {
    zh: (p: { msg: string }) => `getUpdates 网络错误: ${p.msg}`,
    en: (p) => `getUpdates network error: ${p.msg}`,
  },
  'telegram.getUpdatesTimeout': {
    zh: () => 'getUpdates 请求超时',
    en: () => 'getUpdates request timed out',
  },
  'telegram.noTokenSend': {
    zh: () => '未配置 Token，无法发送消息',
    en: () => 'Token not configured, cannot send message',
  },

  'ft.rebuildSpec': {
    zh: (p: { count: number; pair: string }) => `收到 _conditions (${p.count}个), 主对=${p.pair}, 重建 spec...`,
    en: (p: { count: number; pair: string }) => `Got _conditions (${p.count}), main pair=${p.pair}, rebuilding spec...`,
  },
  'ft.specRebuilt': {
    zh: (p: { indicator: string; pair: string }) => `spec 已重建, 指标=${p.indicator}, pair=${p.pair}`,
    en: (p: { indicator: string; pair: string }) => `spec rebuilt, indicator=${p.indicator}, pair=${p.pair}`,
  },
  'ft.strategyFileWritten': {
    zh: (p: { path: string }) => `策略文件已写入: ${p.path}`,
    en: (p: { path: string }) => `Strategy file written: ${p.path}`,
  },
  'ft.detected': {
    zh: (p: { line: string }) => `检测到 freqtrade: ${p.line}`,
    en: (p: { line: string }) => `freqtrade detected: ${p.line}`,
  },
  'ft.exeNotFound': {
    zh: () => '未找到 freqtrade 可执行文件',
    en: () => 'freqtrade executable not found',
  },
  'ft.exeNotFoundHint': {
    zh: () => '未找到 freqtrade，请先安装 (pip install freqtrade) 或配置 venv',
    en: () => 'freqtrade not found, please install (pip install freqtrade) or configure venv',
  },
  'ft.port8080Released': {
    zh: (p: { pid: string }) => `已释放端口 8080 (PID=${p.pid})`,
    en: (p: { pid: string }) => `Port 8080 released (PID=${p.pid})`,
  },
  'ft.alreadyRunning': {
    zh: (p: { id: string; pid: number }) => `策略 ${p.id} 已在运行中, PID: ${p.pid}`,
    en: (p: { id: string; pid: number }) => `Strategy ${p.id} is already running, PID: ${p.pid}`,
  },
  'ft.strategyFileWriteFailed': {
    category: 'SYSTEM',
    zh: (p: { msg: string }) => `策略文件写入失败: ${p.msg}`,
    en: (p: { msg: string }) => `Strategy file write failed: ${p.msg}`,
  },
  'ft.strategyFileDumpedNoStart': {
    category: 'SYSTEM',
    zh: (p: { path: string }) => `策略文件已落盘但无法启动: ${p.path}`,
    en: (p: { path: string }) => `Strategy file saved but failed to launch: ${p.path}`,
  },
  'ft.start': {
    zh: (p: { name: string; id: string }) => `启动 ${p.name} (${p.id}, config 已生成)`,
    en: (p: { name: string; id: string }) => `Starting ${p.name} (${p.id}, config generated)`,
  },
  'ft.startTimeout': {
    category: 'SYSTEM',
    zh: (p: { id: string; secs: number }) => `策略 ${p.id} 启动超时（${p.secs}秒）`,
    en: (p: { id: string; secs: number }) => `Strategy ${p.id} startup timeout (${p.secs}s)`,
  },
  'ft.startCancelled': {
    category: 'SYSTEM',
    zh: (p: { id: string }) => `策略 ${p.id} 启动已取消（下载期间被停止）`,
    en: (p: { id: string }) => `Strategy ${p.id} start cancelled (stopped during download)`,
  },
  'ft.spawnOk': {
    zh: (p: { pid: number; strategy: string }) => `子进程已启动 (PID=${p.pid}, strategy=${p.strategy})`,
    en: (p: { pid: number; strategy: string }) => `Subprocess launched (PID=${p.pid}, strategy=${p.strategy})`,
  },
  'ft.startSuccess': {
    zh: (p: { id: string; pid: number }) => `策略 ${p.id} 启动成功, PID: ${p.pid}`,
    en: (p: { id: string; pid: number }) => `Strategy ${p.id} started, PID: ${p.pid}`,
  },
  'ft.startFailed': {
    category: 'SYSTEM',
    zh: (p: { id: string; err: string }) => `策略 ${p.id} 启动失败: ${p.err}`,
    en: (p: { id: string; err: string }) => `Strategy ${p.id} startup failed: ${p.err}`,
  },
  'ft.exit': {
    zh: (p: { id: string; msg: string }) => `策略 ${p.id} ${p.msg}`,
    en: (p: { id: string; msg: string }) => `Strategy ${p.id} ${p.msg}`,
  },
  'ft.abnormalExit': {
    category: 'SYSTEM',
    zh: (p: { id: string; code: number }) => `策略 ${p.id} 异常退出，退出码: ${p.code}`,
    en: (p: { id: string; code: number }) => `Strategy ${p.id} abnormal exit, code: ${p.code}`,
  },
  'ft.spawnErr': {
    category: 'SYSTEM',
    zh: (p: { id: string; msg: string }) => `策略 ${p.id} spawn 错误: ${p.msg}`,
    en: (p: { id: string; msg: string }) => `Strategy ${p.id} spawn error: ${p.msg}`,
  },
  'ft.apiReady': {
    zh: (p: { id: string; pid: number; secs: string }) => `策略 ${p.id} PID=${p.pid}, API 就绪 (${p.secs}s)`,
    en: (p: { id: string; pid: number; secs: string }) => `Strategy ${p.id} PID=${p.pid}, API ready (${p.secs}s)`,
  },
  'ft.botStarted': {
    zh: () => 'freqtrade bot 已启动 (dry-run)',
    en: () => 'freqtrade bot started (dry-run)',
  },
  'ft.startFailedStatus': {
    category: 'SYSTEM',
    zh: (p: { status: number; text: string }) => `freqtrade bot /start 失败: ${p.status} - ${p.text}`,
    en: (p: { status: number; text: string }) => `freqtrade bot /start failed: ${p.status} - ${p.text}`,
  },
  'ft.startApiErr': {
    category: 'SYSTEM',
    zh: (p: { msg: string }) => `freqtrade API /start 异常: ${p.msg}`,
    en: (p: { msg: string }) => `freqtrade API /start error: ${p.msg}`,
  },
  'ft.spawnAbnormal': {
    category: 'SYSTEM',
    zh: (p: { id: string; msg: string }) => `策略 ${p.id} spawn 异常: ${p.msg}`,
    en: (p: { id: string; msg: string }) => `Strategy ${p.id} spawn exception: ${p.msg}`,
  },
  'ft.signalIgnored': {
    zh: (p: { id: string }) => `策略 ${p.id} 未在运行中，信号被忽略`,
    en: (p: { id: string }) => `Strategy ${p.id} not running, signal ignored`,
  },
  'ft.stopLive': {
    zh: (p: { id: string }) => `停止 live 策略: ${p.id}`,
    en: (p: { id: string }) => `Stopping live strategy: ${p.id}`,
  },
  'ft.stopStrategy': {
    zh: (p: { id: string; pid: number }) => `停止策略 ${p.id}, PID: ${p.pid}`,
    en: (p: { id: string; pid: number }) => `Stopped strategy ${p.id}, PID: ${p.pid}`,
  },
  'ft.strategyNotRunning': {
    zh: (p: { id: string }) => `策略 ${p.id} 未在运行中`,
    en: (p: { id: string }) => `Strategy ${p.id} not running`,
  },
  'ft.dbCleaned': {
    zh: (p: { count: number }) => `清理了 ${p.count} 个旧 dry-run 数据库文件`,
    en: (p: { count: number }) => `Cleaned up ${p.count} old dry-run database file(s)`,
  },
  'ft.backtestResultsCleaned': {
    zh: (p: { count: number; kept: number }) => `清理了 ${p.count} 个旧回测结果（保留最近 ${p.kept} 个）`,
    en: (p: { count: number; kept: number }) => `Cleaned up ${p.count} old backtest result(s) (kept latest ${p.kept})`,
  },
  'ft.pycacheCleaned': {
    zh: (p: { count: number }) => `清理了 ${p.count} 个 Python 字节码缓存文件`,
    en: (p: { count: number }) => `Cleaned up ${p.count} Python bytecode cache file(s)`,
  },
  'ft.backtestFileWritten': {
    zh: (p: { name: string }) => `回测策略文件已落盘: ${p.name}`,
    en: (p: { name: string }) => `Backtest strategy file saved: ${p.name}`,
  },
  'ft.backtestStartReq': {
    zh: (p: { name: string; timerange: string }) => `回测启动请求: 策略=${p.name}, 时间范围=${p.timerange}`,
    en: (p: { name: string; timerange: string }) => `Backtest start request: strategy=${p.name}, timerange=${p.timerange}`,
  },
  'ft.backtestStopped': {
    zh: () => '回测已停止',
    en: () => 'Backtest stopped',
  },
  'ft.backtestApiStart': {
    zh: (p: { port: number; config: string }) => `启动回测 API 服务, 端口: ${p.port}, config: ${p.config}`,
    en: (p: { port: number; config: string }) => `Starting backtest API service, port: ${p.port}, config: ${p.config}`,
  },
  'ft.backtestApiStarted': {
    zh: (p: { port: number }) => `回测 API 服务启动成功, 端口: ${p.port}`,
    en: (p: { port: number }) => `Backtest API service started, port: ${p.port}`,
  },
  'ft.backtestApiRunning': {
    zh: (p: { port: number }) => `回测 API 服务进程已运行, 端口: ${p.port}（未检测到启动标识，按超时判定成功）`,
    en: (p: { port: number }) => `Backtest API process already running, port: ${p.port} (no startup marker, assumed success by timeout)`,
  },
  'ft.backtestStop': {
    zh: (p: { pid: number }) => `停止回测服务, PID: ${p.pid}`,
    en: (p: { pid: number }) => `Stopping backtest service, PID: ${p.pid}`,
  },
  'ft.stopAll': {
    zh: (p: { count: number }) => `停止所有 freqtrade 进程（${p.count} 个 live 策略 + 回测服务）`,
    en: (p: { count: number }) => `Stopping all freqtrade processes (${p.count} live strategies + backtest service)`,
  },
  'ft.stopFailed': {
    category: 'SYSTEM',
    zh: (p: { id: string; msg: string }) => `停止策略 ${p.id} 失败: ${p.msg}`,
    en: (p: { id: string; msg: string }) => `Failed to stop strategy ${p.id}: ${p.msg}`,
  },

  'ft.btPhaseDownloading': {
    zh: () => '回测阶段: 正在下载K线数据...',
    en: () => 'Backtest phase: Downloading K-line data...',
  },
  'ft.btDownloadKline': {
    zh: (p: { exchange: string; pairs: string; timeframes: string; days: number }) =>
      `下载K线数据: 交易所=${p.exchange}, 交易对=[${p.pairs}], 周期=[${p.timeframes}], 天数=${p.days}`,
    en: (p: { exchange: string; pairs: string; timeframes: string; days: number }) =>
      `Downloading K-line data: exchange=${p.exchange}, pairs=[${p.pairs}], timeframes=[${p.timeframes}], days=${p.days}`,
  },
  'ft.btDownloadDone': {
    zh: () => 'K线数据下载完成',
    en: () => 'K-line data download completed',
  },
  'ft.btDownloadFailed': {
    zh: (p: { msg: string }) => `K线数据下载失败: ${p.msg}`,
    en: (p: { msg: string }) => `K-line data download failed: ${p.msg}`,
  },
  'ft.klineDownloadWarn': {
    zh: (p: { msg: string }) => `K线下载失败，继续启动（FT 会自行重试）: ${p.msg}`,
    en: (p: { msg: string }) => `K-line download failed, continuing startup (FT will retry): ${p.msg}`,
  },
  'ft.klineDownloadErr': {
    zh: (p: { msg: string }) => `K线下载异常: ${p.msg}`,
    en: (p: { msg: string }) => `K-line download error: ${p.msg}`,
  },
  'ft.klineDownloadSkip': {
    zh: (p: { id: string }) => `未下载K线（策略${p.id}无交易对），FT启动后自行拉取`,
    en: (p: { id: string }) => `K-line download skipped (no pairs), FT will fetch on startup`,
  },
  'ft.btPhaseRunning': {
    zh: () => '回测阶段: K线下载完成, 启动回测...',
    en: () => 'Backtest phase: K-line download done, starting backtest...',
  },
  'ft.btLaunch': {
    zh: (p: { name: string; timerange: string }) => `回测启动: 策略=${p.name}, 时间范围=${p.timerange}`,
    en: (p: { name: string; timerange: string }) => `Backtest launched: strategy=${p.name}, timerange=${p.timerange}`,
  },
  'ft.btDone': {
    zh: (p: { trades: number; winRate: string; profit: string }) =>
      `回测完成: 交易${p.trades}笔, 胜率${p.winRate}%, 总收益${p.profit}%`,
    en: (p: { trades: number; winRate: string; profit: string }) =>
      `Backtest completed: ${p.trades} trades, win rate ${p.winRate}%, total P&L ${p.profit}%`,
  },
  'ft.btResultParseError': {
    zh: (p: { msg: string }) => `回测结果解析异常: ${p.msg}`,
    en: (p: { msg: string }) => `Backtest result parse error: ${p.msg}`,
  },
  'ft.btExecFailed': {
    zh: (p: { msg: string }) => `回测执行失败: ${p.msg}`,
    en: (p: { msg: string }) => `Backtest execution failed: ${p.msg}`,
  },
  'ft.btReadResultFailed': {
    zh: (p: { msg: string }) => `读取回测结果失败: ${p.msg}`,
    en: (p: { msg: string }) => `Failed to read backtest result: ${p.msg}`,
  },
  'ft.btUnzipFailed': {
    zh: (p: { msg: string }) => `解压回测结果zip失败: ${p.msg}`,
    en: (p: { msg: string }) => `Failed to extract backtest result zip: ${p.msg}`,
  },
  'ft.btTimeout': {
    zh: (p: { seconds: number }) => `回测超时（${p.seconds}秒）`,
    en: (p: { seconds: number }) => `Backtest timeout (${p.seconds}s)`,
  },
  'ft.stakeAmountConverted': {
    zh: (p: { contractSize: string; price: string; amount: string }) =>
      `stakeAmount自动换算: ${p.contractSize} × ${p.price} → ${p.amount} USDT`,
    en: (p: { contractSize: string; price: string; amount: string }) =>
      `stakeAmount auto-converted: ${p.contractSize} × ${p.price} → ${p.amount} USDT`,
  },
  'ft.marketPriceFailed': {
    zh: () => '市价获取失败，使用默认stakeAmount',
    en: () => 'Market price fetch failed, using default stakeAmount',
  },

  'market.scannerStarted': {
    zh: (p: { exchange?: string }) => `市场扫描服务已启动 (${p.exchange || 'okx'})`,
    en: (p: { exchange?: string }) => `Market scanner started (${p.exchange || 'okx'})`,
  },
  'market.scannerStopped': {
    zh: () => '市场扫描服务已停止',
    en: () => 'Market scanner stopped',
  },
  'market.fetchFailed': {
    category: 'API',
    zh: (p: { exchange?: string; status: number }) => `市场数据拉取失败 ${p.exchange || 'okx'} HTTP ${p.status}`,
    en: (p: { exchange?: string; status: number }) => `Market data fetch failed ${p.exchange || 'okx'} HTTP ${p.status}`,
  },
  'market.fetchError': {
    zh: (p: { exchange?: string; code: string }) => `市场数据解析异常 ${p.exchange || 'okx'} code=${p.code}`,
    en: (p: { exchange?: string; code: string }) => `Market data parse error ${p.exchange || 'okx'} code=${p.code}`,
  },
  'market.fetchException': {
    zh: (p: { exchange?: string; msg: string }) => `市场数据请求异常 ${p.exchange || 'okx'} ${p.msg}`,
    en: (p: { exchange?: string; msg: string }) => `Market data request exception ${p.exchange || 'okx'} ${p.msg}`,
  },

} as const;
