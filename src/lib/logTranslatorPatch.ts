
const CONDITION_TYPE_MAP: Record<string, string> = {
  '指标条件': 'Indicator Condition',
  '时间窗口': 'Time Window',
  '冷却': 'Cooldown',
  '次数限制': 'Count Limit',
  'TV信号': 'TV Signal',
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
};

const WORD_MAP: Record<string, string> = {
  '检测': 'Check',
  '结果': 'Result',
  '触发': 'triggered',
  '未触发': 'not triggered',
  '指标': 'Indicator',
  '当前': 'Current',
  '允许': 'Allowed',
  '从未使用': 'Never used',
  '无冷却': 'No cooldown',
  '剩余': 'Remaining',
  '已触发': 'Triggered',
  '信号': 'Signal',
  '有': 'yes',
  '无': 'no',
  '仓位方向': 'Position Side',
  '目标': 'Target',
};

const INDICATOR_LABEL_MAP: Record<string, string> = {
  '开盘价': 'Open',
  '收盘价': 'Close',
  '最高价': 'High',
  '最低价': 'Low',
  '价格': 'Price',
  '成交量': 'Volume',
  'VOL': 'Volume',
  'DIFF': 'DIFF',
  'DEA': 'DEA',
  'LB': 'LB',
  'BOLL': 'BOLL',
  'UB': 'UB',
  'KDJ-K': 'K',
  'KDJ-D': 'D',
  'KDJ-J': 'J',
};

function translateConditionLog(msg: string): string {
  let result = msg.replace(/^检测:\s*/, 'Check: ');

  for (const [zh, en] of Object.entries(CONDITION_TYPE_MAP)) {
    result = result.replace(zh, en);
  }

  for (const [zh, en] of Object.entries(WORD_MAP)) {
    result = result.replace(new RegExp(zh, 'g'), en);
  }

  for (const [zh, en] of Object.entries(INDICATOR_LABEL_MAP)) {
    result = result.replace(new RegExp(zh, 'g'), en);
  }

  const weekdayMap: Record<string, string> = {
    '星期日': 'Sunday', '星期一': 'Monday', '星期二': 'Tuesday',
    '星期三': 'Wednesday', '星期四': 'Thursday', '星期五': 'Friday', '星期六': 'Saturday',
  };
  for (const [zh, en] of Object.entries(weekdayMap)) {
    result = result.replace(zh, en);
  }

  const shortDayMap: Record<string, string> = {
    '日': 'Sun', '一': 'Mon', '二': 'Tue', '三': 'Wed',
    '四': 'Thu', '五': 'Fri', '六': 'Sat',
  };
  result = result.replace(/\(([^)]+)\)/g, (match, inner: string) => {
    const translated = inner.replace(/[日一二三四五六]/g, (ch: string) => shortDayMap[ch] || ch);
    return `(${translated})`;
  });

  return result;
}

export function translateExecutionLog(msg: string, activeLanguage: string): string {
  if (!activeLanguage?.startsWith('en') || !msg) return msg;

  if (msg.startsWith('检测:')) {
    return translateConditionLog(msg);
  }

  const chineseCount = (msg.match(/[\u4e00-\u9fff]/g) || []).length;
  if (chineseCount >= 3 && !msg.startsWith('【未翻译】')) {
    return '【未翻译】' + msg;
  }
  return msg;
}
