/**
 * Execução de uma lista de tarefas com limite de concorrência e de taxa.
 *
 * Genérico de propósito: não sabe de nota fiscal. `runPool` nunca rejeita por causa
 * de uma tarefa — cada resultado diz se deu certo, para que um item ruim não derrube
 * os outros.
 */

export interface PoolOptions {
  /** Tarefas ao mesmo tempo. Padrão 4 */
  concurrency?: number;
  /** Teto de inícios por segundo, somando todas as tarefas. Sem teto por padrão */
  ratePerSecond?: number;
  /** Interrompe: o que ainda não começou é marcado como `skipped` */
  signal?: AbortSignal;
}

export type PoolResult<T> =
  | { status: "done"; value: T }
  | { status: "failed"; error: unknown }
  | { status: "skipped" };

export const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

export async function runPool<I, T>(
  items: readonly I[],
  task: (item: I, index: number) => Promise<T>,
  { concurrency = 4, ratePerSecond, signal }: PoolOptions = {},
  onSettled?: (index: number, result: PoolResult<T>) => void,
): Promise<PoolResult<T>[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError(`concurrency must be a positive integer, got ${concurrency}`);
  }
  if (ratePerSecond !== undefined && !(ratePerSecond > 0)) {
    throw new RangeError(`ratePerSecond must be positive, got ${ratePerSecond}`);
  }

  const results: PoolResult<T>[] = new Array(items.length);
  const interval = ratePerSecond ? 1000 / ratePerSecond : 0;
  let nextStart = 0;
  let cursor = 0;

  // Reserva o próximo instante de início de forma síncrona: dois trabalhadores nunca
  // recebem o mesmo horário.
  const reserve = () => {
    const now = Date.now();
    const at = Math.max(now, nextStart);
    nextStart = at + interval;
    return at - now;
  };

  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      if (signal?.aborted) {
        results[index] = { status: "skipped" };
        onSettled?.(index, results[index]!);
        continue;
      }
      const wait = interval ? reserve() : 0;
      if (wait > 0) await sleep(wait);
      if (signal?.aborted) {
        results[index] = { status: "skipped" };
      } else {
        try {
          results[index] = { status: "done", value: await task(items[index]!, index) };
        } catch (error) {
          results[index] = { status: "failed", error };
        }
      }
      onSettled?.(index, results[index]!);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}
