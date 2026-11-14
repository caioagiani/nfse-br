import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runPool, sleep } from "../src/infra/batch.ts";

describe("runPool", () => {
  it("respeita o limite de concorrência e mantém a ordem dos resultados", async () => {
    let running = 0;
    let peak = 0;
    const results = await runPool(
      [30, 10, 20, 5, 15, 1],
      async (ms) => {
        peak = Math.max(peak, ++running);
        await sleep(ms);
        running--;
        return ms * 2;
      },
      { concurrency: 3 },
    );
    assert.equal(peak, 3);
    assert.deepEqual(results.map((r) => (r.status === "done" ? r.value : null)), [60, 20, 40, 10, 30, 2]);
  });

  it("uma tarefa que falha não derruba as outras", async () => {
    const results = await runPool([1, 2, 3], async (n) => {
      if (n === 2) throw new Error("boom");
      return n;
    });
    assert.deepEqual(results.map((r) => r.status), ["done", "failed", "done"]);
    assert.equal((results[1] as { error: Error }).error.message, "boom");
  });

  it("ratePerSecond espaça os inícios, mesmo com concorrência sobrando", async () => {
    const starts: number[] = [];
    const t0 = Date.now();
    await runPool([1, 2, 3, 4], async () => void starts.push(Date.now() - t0), { concurrency: 4, ratePerSecond: 20 });
    // 20/s = 50 ms entre inícios; folga para o relógio do CI
    for (let i = 1; i < starts.length; i++) assert.ok(starts[i]! - starts[i - 1]! >= 40, `gap ${i}: ${starts}`);
  });

  it("abortar marca o que não começou como skipped e deixa terminar o que começou", async () => {
    const controller = new AbortController();
    const results = await runPool(
      [1, 2, 3, 4, 5],
      async (n) => {
        if (n === 2) controller.abort();
        await sleep(5);
        return n;
      },
      { concurrency: 1, signal: controller.signal },
    );
    assert.deepEqual(results.map((r) => r.status), ["done", "done", "skipped", "skipped", "skipped"]);
  });

  it("onSettled recebe cada resultado", async () => {
    const seen: number[] = [];
    await runPool([7, 8], async (n) => n, {}, (index) => void seen.push(index));
    assert.deepEqual(seen.sort(), [0, 1]);
  });

  it("recusa concorrência e taxa inválidas", async () => {
    await assert.rejects(runPool([1], async () => 1, { concurrency: 0 }), RangeError);
    await assert.rejects(runPool([1], async () => 1, { ratePerSecond: -1 }), RangeError);
  });

  it("lista vazia devolve lista vazia", async () => {
    assert.deepEqual(await runPool([], async () => 1), []);
  });
});
