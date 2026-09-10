
import { DiyEngine } from '../engine/diy/DiyEngine.ts';
import { LogService } from '../services/logService.ts';

export interface FtSignal {
  strategyId: string;
  event: 'entry' | 'exit';
  pair: string;
  direction?: 'long' | 'short';
  price?: number;
}

export interface FtWebhookPayload {
  value1: string;
  value2: string;
  value3: string;
}

const ENTRY_DIRECTIONS = new Set(['long', 'short']);

export function parseFtPayload(strategyId: string, body: FtWebhookPayload): FtSignal {
  let event: 'entry' | 'exit';
  let direction: 'long' | 'short' | undefined;
  let price: number | undefined;

  if (ENTRY_DIRECTIONS.has(String(body.value2).trim().toLowerCase())) {
    event = 'entry';
    direction = String(body.value2).trim().toLowerCase() as 'long' | 'short';
    price = parseFloat(String(body.value3 || '0')) || undefined;
  } else {
    event = 'exit';
  }

  return {
    strategyId,
    event,
    pair: String(body.value1 || ''),
    direction,
    price,
  };
}

export async function handleFtSignal(signal: FtSignal): Promise<boolean> {
  const diyEngine = DiyEngine.getInstance();

  if (signal.event === 'exit') return true;

  LogService.logKey('freqtrade', 'ft.signalReceived', { pair: signal.pair }, 'info', signal.strategyId);

  const ok = diyEngine.pushSignal(signal.strategyId, {
    signal: signal.direction === 'short' ? 'short' : 'long',
    pair: signal.pair,
    direction: signal.direction,
    price: signal.price,
  }, 'ft');

  if (!ok) {
    LogService.logKey('freqtrade', 'ft.signalIgnored', { id: signal.strategyId }, 'warn');
  }

  return ok;
}
