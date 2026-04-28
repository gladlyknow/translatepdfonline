/** 简单异步并发池（与 onlinepdftranslator pool 对齐）。 */
export async function runPool<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  if (items.length === 0) return;
  const n = Math.max(1, Math.min(concurrency, items.length));
  let idx = 0;
  async function worker() {
    while (true) {
      const i = idx++;
      if (i >= items.length) break;
      await fn(items[i]!);
    }
  }
  await Promise.all(Array.from({ length: n }, () => worker()));
}
