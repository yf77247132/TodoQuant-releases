
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
  '24H涨幅检测': '24H Change',
  '当日涨幅检测': 'Daily Change',
  '涨幅检测': 'Price Change',
};

const WORD_MAP: Record<string, string> = {
  '策略已启动监控并预热数据': 'Strategy started monitoring with data warmup',
  '所有动作执行完成': 'All actions completed',
  '动作执行失败': 'Action failed',
  '正在执行动作': 'Executing actions',
  '条件满足': 'Conditions met',
  '回调比例/价距': 'Callback/Gap',
  '个交易对满足': ' pairs matched',
  '首次检测': 'First check',
  '数据预热中': 'Data warming up',
  '数据未就绪': 'Data not ready',
  '未指定交易对': 'No instrument specified',
  '已触发过': 'already triggered',
  '24h涨幅': '24h Change',
  '当日涨幅': 'Daily Change',
  '判断逻辑': 'Logic',
  '仓位方向': 'Position Side',
  '从未使用': 'Never used',
  '实盘执行': 'Live',
  '大于等于': '>=',
  '小于等于': '<=',
  '检测': 'Check',
  '结果': 'Result',
  '阈值': 'Threshold',
  '上穿': 'Cross Above',
  '下穿': 'Cross Below',
  '大于': '>',
  '小于': '<',
  '等于': '=',
  '最高': 'Max',
  '全部': 'All',
  '剩余': 'Remaining',
  '已触发': 'Triggered',
  '触发': 'triggered',
  '未触发': 'not triggered',
  '指标': 'Indicator',
  '当前': 'Current',
  '允许': 'Allowed',
  '无冷却': 'No cooldown',
  '信号': 'Signal',
  '目标': 'Target',
  '停止策略': 'Stop Strategy',
  '通知': 'Notify',
  '下单模块': 'Place',
  '改单模块': 'Amend',
  '撤单模块': 'Cancel',
  '平仓模块': 'Close',
  '转账模块': 'Transfer',
  '有': 'yes',
  '无': 'no',
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

  const sortedTypeEntries = Object.entries(CONDITION_TYPE_MAP).sort((a, b) => b[0].length - a[0].length);
  for (const [zh, en] of sortedTypeEntries) {
    result = result.replace(zh, en);
  }

  const sortedWordEntries = Object.entries(WORD_MAP).sort((a, b) => b[0].length - a[0].length);
  for (const [zh, en] of sortedWordEntries) {
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

  result = result.replace(/等([),]|$)/g, ' etc.$1');

  return result;
}

function translateActionLog(msg: string): string {
  let result = msg;

  for (const [zh, en] of Object.entries(WORD_MAP)) {
    result = result.replace(new RegExp(zh, 'g'), en);
  }

  result = result.replace(/等([),]|$)/g, ' etc.$1');

  return result;
}

export function translateExecutionLog(msg: string, activeLanguage: string): string {
  if (!activeLanguage?.startsWith('en') || !msg) return msg;

  if (msg.startsWith('检测:')) {
    return translateConditionLog(msg);
  }

  const chineseCount = (msg.match(/[\u4e00-\u9fff]/g) || []).length;
  if (chineseCount >= 2) {
    return translateActionLog(msg);
  }

  return msg;
}
