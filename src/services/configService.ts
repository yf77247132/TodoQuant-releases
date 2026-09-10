
import { encrypt, decrypt, clearPbKdf2Cache } from '../lib/encryption.ts';
import { dpapiEncrypt, dpapiDecrypt } from '../lib/dpapi.ts';
import { AppConfig, ExchangeAccount, Exchange } from '../types/index.ts';
import { LogService } from './logService.ts';
import { dbService } from './dbService.ts';
import { backupTo } from './dbService.ts';
import { getBackupPath } from '../lib/getAppPath.ts';
import { BINANCE_YELLOW } from '../constants/colors.ts';

const MASTER_KEY_MIN_LENGTH = 6;

let memoryMasterKey: string | null = null;

let cachedDpapiMasterKey: string | null | undefined = undefined;

let configCache: { data: AppConfig; ts: number } | null = null;
const CONFIG_CACHE_TTL_MS = 30000;

export function invalidateConfigCache() {
  configCache = null;
}

export function setMemoryMasterKey(key: string) {
  if (key.length >= MASTER_KEY_MIN_LENGTH) {
    memoryMasterKey = key;
    LogService.info('CONFIG', '主密钥已在内存中设置。');
  }
}

export function clearMemoryMasterKey() {
  memoryMasterKey = null;
  cachedDpapiMasterKey = undefined;
  LogService.info('CONFIG', '主密钥已从内存中清除。');
}

export function getDatabaseMasterKey(): string | null {
  const savedMasterKey = dbService.getConfig('masterKey');
  if (!savedMasterKey) return null;

  if (savedMasterKey.startsWith('dpapi:') || savedMasterKey.startsWith('aes:')) {
    try {
      if (cachedDpapiMasterKey === undefined) {
        cachedDpapiMasterKey = dpapiDecrypt(savedMasterKey);
      }
      if (cachedDpapiMasterKey && cachedDpapiMasterKey.length >= MASTER_KEY_MIN_LENGTH) {
        return cachedDpapiMasterKey;
      }
    } catch {
      LogService.warn('CONFIG', '主密钥 DPAPI 解密失败，可能需要重新输入');
      return null;
    }
  }

  if (savedMasterKey.length >= MASTER_KEY_MIN_LENGTH) return savedMasterKey;
  return null;
}

export function getEffectiveMasterKey(): string | null {
  if (memoryMasterKey && memoryMasterKey.length >= MASTER_KEY_MIN_LENGTH) return memoryMasterKey;

  return getDatabaseMasterKey();
}

export function loadSavedConfig(): AppConfig {
  if (configCache && (Date.now() - configCache.ts < CONFIG_CACHE_TTL_MS)) {
    return configCache.data;
  }

  const dbMasterKey = getDatabaseMasterKey();

  const configs = dbService.getAllConfigs();
  const accounts = dbService.getAccounts();

  const config: AppConfig = {
    ...configs,
    accounts: accounts.map(acc => ({
      ...acc,
      isEncrypted: (acc as any).isEncrypted === 1,
      exchange: (acc.exchange as string).toUpperCase() as Exchange
    }))
  };

  if (config.accountOrder && Array.isArray(config.accountOrder) && config.accountOrder.length > 0) {
    const orderMap = new Map(config.accountOrder.map((id, idx) => [id, idx]));
    config.accounts.sort((a, b) => {
      const ai = orderMap.get(a.id);
      const bi = orderMap.get(b.id);
      if (ai !== undefined && bi !== undefined) return ai - bi;
      if (ai !== undefined) return -1;
      if (bi !== undefined) return 1;
      return (a.createdAt || 0) - (b.createdAt || 0);
    });
  }

  if (!dbMasterKey) {
    configCache = { data: config, ts: Date.now() };
    return config;
  }

  config.accounts = config.accounts.map((acc: ExchangeAccount) => {
    if (acc.isEncrypted) {
      try {
        return {
          ...acc,
          apiKey: decrypt(acc.apiKey, dbMasterKey),
          secretKey: decrypt(acc.secretKey, dbMasterKey),
          passphrase: acc.passphrase ? decrypt(acc.passphrase, dbMasterKey) : acc.passphrase,
          isEncrypted: false,
        };
      } catch (e) {
        return { ...acc, _decryptionFailed: true };
      }
    }
    return acc;
  });

  configCache = { data: config, ts: Date.now() };
  return config;
}

export function saveConfigToFile(cfg: Partial<AppConfig>): boolean {
  invalidateConfigCache();

  const currentMasterKey = getEffectiveMasterKey();

  try {
    if (cfg.masterKey && cfg.masterKey.length < MASTER_KEY_MIN_LENGTH) {
      LogService.userError('CONFIG', `Master Key 长度不能少于 ${MASTER_KEY_MIN_LENGTH} 个字符`);
      throw new Error(`New Master Key must be at least ${MASTER_KEY_MIN_LENGTH} characters long.`);
    }

    const existing = loadSavedConfig();
    
    const dbMasterKey = getDatabaseMasterKey();
    
    let targetMasterKey = currentMasterKey;
    let isMasterKeyChanged = false;
    if (cfg.masterKey && cfg.masterKey !== dbMasterKey) {
      LogService.info('CONFIG', '检测到主密钥更换，正在重新加密账户...');
      targetMasterKey = cfg.masterKey;
      isMasterKeyChanged = true;
    }

    const { accounts, ...otherConfigs } = cfg;

    if (otherConfigs.masterKey) {
      otherConfigs.masterKey = dpapiEncrypt(otherConfigs.masterKey as string);
      cachedDpapiMasterKey = undefined;
      clearPbKdf2Cache();
    }

    if (Object.keys(otherConfigs).length > 0) {
      dbService.setConfigs(otherConfigs);
    }

    if (accounts && Array.isArray(accounts)) {
      accounts.forEach((acc: ExchangeAccount) => {
        let accountToSave = { ...acc };

        if (targetMasterKey) {
          if (acc.isEncrypted) {
            if (isMasterKeyChanged) {
              try {
                const plainApi = decrypt(acc.apiKey, currentMasterKey!);
                const plainSecret = decrypt(acc.secretKey, currentMasterKey!);
                const plainPass = acc.passphrase ? decrypt(acc.passphrase, currentMasterKey!) : acc.passphrase;

                accountToSave.apiKey = encrypt(plainApi, targetMasterKey);
                accountToSave.secretKey = encrypt(plainSecret, targetMasterKey);
                accountToSave.passphrase = plainPass ? encrypt(plainPass, targetMasterKey) : plainPass;
                accountToSave.isEncrypted = true;
              } catch (e) {
                const err = e instanceof Error ? e : new Error(String(e));
                LogService.systemError('CONFIG', `账户 ${acc.id} 重新加密失败: ${err.message}，保留原密文`);
                accountToSave = { ...acc };
              }
            }
          } else {
            const isMasked = (v: string | undefined): boolean => {
              if (!v) return true;
              return v.includes('••') || v.startsWith('***');
            };
            if (isMasked(acc.apiKey)) {
              const existingAcc = existing.accounts?.find(a => a.id === acc.id);
              if (existingAcc) {
                accountToSave = {
                  ...existingAcc,
                  ...acc,
                  apiKey: existingAcc.apiKey,
                  secretKey: isMasked(acc.secretKey) ? existingAcc.secretKey : acc.secretKey,
                  passphrase: isMasked(acc.passphrase) ? existingAcc.passphrase : acc.passphrase,
                  isEncrypted: existingAcc.isEncrypted
                };
              }
            } else {
              accountToSave.apiKey = encrypt(acc.apiKey, targetMasterKey);
              accountToSave.secretKey = encrypt(acc.secretKey, targetMasterKey);
              accountToSave.passphrase = acc.passphrase ? encrypt(acc.passphrase, targetMasterKey) : acc.passphrase;
              accountToSave.isEncrypted = true;
            }
          }
        }

        dbService.saveAccount(accountToSave);
      });
    } else if (isMasterKeyChanged && existing.accounts) {
      LogService.info('CONFIG', `正在重新加密 ${existing.accounts.length} 个已有账户...`);
      existing.accounts.forEach((acc: ExchangeAccount) => {
        if ((acc as any)._decryptionFailed) {
          LogService.warn('CONFIG', `账户 ${acc.name || acc.id} 解密失败，跳过重新加密`);
          return;
        }
        try {
          const reEncrypted: ExchangeAccount = {
            ...acc,
            apiKey: encrypt(acc.apiKey, targetMasterKey),
            secretKey: encrypt(acc.secretKey, targetMasterKey),
            passphrase: acc.passphrase ? encrypt(acc.passphrase, targetMasterKey) : acc.passphrase,
            isEncrypted: true
          };
          dbService.saveAccount(reEncrypted);
        } catch (e) {
          const err = e instanceof Error ? e : new Error(String(e));
          LogService.systemError('CONFIG', `账户 ${acc.name || acc.id} 重新加密失败: ${err.message}，保留原密文`);
        }
      });

      const allAccounts = dbService.getAccounts();
      const accountNames: Record<string, string> = { ...existing.accountNames };
      const accountColors: Record<string, string> = { ...existing.accountColors };
      const accountExchanges: Record<string, string> = { ...existing.accountExchanges };
      
      allAccounts.forEach((acc) => {
        accountNames[acc.id] = acc.name;
        accountColors[acc.id] = acc.color || BINANCE_YELLOW;
        accountExchanges[acc.id] = acc.exchange;
      });

      dbService.setConfig('accountNames', accountNames);
      dbService.setConfig('accountColors', accountColors);
      dbService.setConfig('accountExchanges', accountExchanges);
    }

    invalidateConfigCache();

    backupTo(getBackupPath()).catch(() => {});

    return true;
  } catch (error: unknown) {
    const err = error as Error;
    LogService.logKey('CONFIG', 'config.saveFailed', { msg: err.message || String(err) }, 'error');
    return false;
  }
}
