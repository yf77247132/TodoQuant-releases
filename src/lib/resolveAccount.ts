
import type { ExchangeAccount } from '../types/core.ts';

export interface ResolveAccountResult {
  account: ExchangeAccount;
  accountIdx: number;
}

export interface ResolveAccountError {
  error: string;
}

type ResolveAccountOutcome = ResolveAccountResult | ResolveAccountError;

export function resolveAccountFromConfig(
  config: Record<string, unknown>,
  _moduleType: string,
  accounts: ExchangeAccount[]
): ResolveAccountOutcome {
  const accountId = String(config.account_id || '').trim();
  if (!accountId) {
    return { error: '缺少 account_id，请重新选择账户' };
  }
  const idx = accounts.findIndex(acc => acc.id === accountId);
  if (idx === -1) {
    return { error: `账户ID [${accountId}] 对应的账户不存在（可能已被删除），请重新选择账户` };
  }
  const account = accounts[idx];
  if (!account.apiKey || !account.secretKey) {
    return { error: `账户 [${account.name}] 缺少 API 密钥，请先添加账户或解锁 Master Key` };
  }
  return { account, accountIdx: idx };
}

export function getAccountNameFromConfig(
  config: Record<string, unknown>,
  accountNames: Record<number, string>,
  accounts: { id: string; name: string }[],
  t?: (key: string) => string
): string {
  const tr = (key: string, fallback: string) => t ? t(key) : fallback;
  const accountId = String(config.account_id || '').trim();
  if (!accountId) return tr('account.unselected', '未选择账号');

  const acc = accounts.find(a => a.id === accountId);
  if (acc) return acc.name;

  if (/^\d+$/.test(accountId)) {
    const name = accountNames[Number(accountId)];
    if (name) return name;
  }

  return tr('account.deleted', '账户(已删除)');
}
