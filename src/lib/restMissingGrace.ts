export interface RestMissingGraceResult {

  keptIds: string[];

  expireIds: string[];

  nextMarkers: Record<string, number>;
}

export function sweepRestMissingGrace(opts: {

  prevMarkers: Record<string, number>;

  candidateIds: string[];

  now: number;

  graceMs: number;
}): RestMissingGraceResult {
  const { prevMarkers, candidateIds, now, graceMs } = opts;
  const keptIds: string[] = [];
  const expireIds: string[] = [];
  const nextMarkers: Record<string, number> = {};

  for (const id of candidateIds) {
    if (!id) continue;
    const missAt = Number(prevMarkers[id] || 0);
    if (!missAt) {
      nextMarkers[id] = now;
      keptIds.push(id);
    } else if (now - missAt > graceMs) {
      expireIds.push(id);
    } else {
      nextMarkers[id] = missAt;
    }
  }

  return { keptIds, expireIds, nextMarkers };
}
