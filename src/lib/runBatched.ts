export async function runBatched<T>(tasks: Array<() => Promise<T>>, limit: number, gapMs: number): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < tasks.length; i += limit) {
    if (i > 0) await new Promise(r => setTimeout(r, gapMs));
    out.push(...await Promise.all(tasks.slice(i, i + limit).map(t => t())));
  }
  return out;
}
