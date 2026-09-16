
export const WS_BUFFER_MAX = 2000;

export const WS_FRAME_MAX = 500;

export interface WsFlushPlan<T> {

  frames: T[][];

  dropped: number;
}

const isLogEntry = (e: unknown): boolean =>
  !!e && typeof e === 'object' && (e as { type?: unknown }).type === 'log';

export function planWsFlush<T>(
  entries: T[],
  bufferMax: number = WS_BUFFER_MAX,
  frameMax: number = WS_FRAME_MAX
): WsFlushPlan<T> {
  let kept = entries;
  let dropped = 0;

  if (entries.length > bufferMax) {
    const logs: T[] = [];
    const nonLogs: T[] = [];
    for (const e of entries) {
      if (isLogEntry(e)) logs.push(e);
      else nonLogs.push(e);
    }

    if (nonLogs.length >= bufferMax) {
      kept = nonLogs.slice(-bufferMax);
    } else {
      const keepLogs = bufferMax - nonLogs.length;
      const keepLogSet = new Set(keepLogs > 0 ? logs.slice(-keepLogs) : []);
      kept = entries.filter(e => !isLogEntry(e) || keepLogSet.has(e));
    }
    dropped = entries.length - kept.length;
  }

  const frames: T[][] = [];
  for (let i = 0; i < kept.length; i += frameMax) {
    frames.push(kept.slice(i, i + frameMax));
  }

  return { frames, dropped };
}
