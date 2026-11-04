/**
 * `async-utils.ts` — generic async helpers shared across functions.
 */

/**
 * Runs `worker` over `items` with at most `limit` concurrent invocations.
 * Throttles IO-bound work (partner API + Firestore) to keep the function responsive.
 *
 * Per-item errors are swallowed — call sites that need error semantics catch
 * inside their own callback.
 *
 * @param items The items to process
 * @param limit Maximum concurrency (>= 1)
 * @param worker Async worker invoked per item (t, idx)
 */
export async function forEachWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (t: T, idx: number) => Promise<void>,
): Promise<void> {
  let i = 0;
  const starters = Array.from({ length: Math.min(limit, items.length) }, () => Promise.resolve());
  await Promise.all(
    starters.map(async () => {
      while (i < items.length) {
        const idx = i++;
        try {
          await worker(items[idx], idx);
        } catch {
          // errors are handled at call sites
        }
      }
    })
  );
}
