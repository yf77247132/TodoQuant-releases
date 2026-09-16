
let tickSzMap: Record<string, number> | null = null;

let fetching: Promise<void> | null = null;

async function ensureLoaded(): Promise<void> {
  if (tickSzMap) return;
  if (fetching) return fetching;
  fetching = (async () => {
    try {
      const resp = await fetch('/api/instruments/tick-sizes');
      if (resp.ok) {
        const json = await resp.json();
        if (json.ok && json.data) {
          tickSzMap = json.data as Record<string, number>;
        }
      }
    } catch {
    } finally {
      fetching = null;
    }
    if (!tickSzMap) tickSzMap = {};
  })();
  return fetching;
}

export async function getTickSz(instId: string): Promise<number | null> {
  await ensureLoaded();
  if (!tickSzMap) return null;
  const v = tickSzMap[instId];
  return v > 0 ? v : null;
}

export function getTickSzSync(instId: string): number | null {
  if (!tickSzMap) return null;
  const v = tickSzMap[instId];
  return v > 0 ? v : null;
}

export { ensureLoaded };
