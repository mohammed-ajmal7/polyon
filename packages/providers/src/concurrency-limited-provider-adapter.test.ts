import { describe, expect, it } from "vitest";

import { ConcurrencyLimitedProviderAdapter, type ModelProviderAdapter } from ".";

function deferredAdapter() {
  let active = 0;
  let peak = 0;
  const releases: (() => void)[] = [];
  const adapter: ModelProviderAdapter<string, string> = {
    providerId: "local",
    async invoke({ input }) {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active -= 1;
      return { output: input };
    },
  };
  return { adapter, releases, peak: () => peak };
}

async function flush(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}

describe("ConcurrencyLimitedProviderAdapter", () => {
  it("never runs more than the configured number of requests at once", async () => {
    const inner = deferredAdapter();
    const limited = new ConcurrencyLimitedProviderAdapter(inner.adapter, 2);

    const results = ["a", "b", "c", "d"].map((input) =>
      limited.invoke({ modelId: "model", input }),
    );
    await flush();
    expect(inner.releases).toHaveLength(2);

    while (inner.releases.length > 0) {
      inner.releases.shift()?.();
      await flush();
    }

    await expect(Promise.all(results)).resolves.toEqual([
      { output: "a" },
      { output: "b" },
      { output: "c" },
      { output: "d" },
    ]);
    expect(inner.peak()).toBe(2);
  });

  it("drops a queued request when its signal aborts", async () => {
    const inner = deferredAdapter();
    const limited = new ConcurrencyLimitedProviderAdapter(inner.adapter, 1);
    const controller = new AbortController();

    const first = limited.invoke({ modelId: "model", input: "first" });
    const queued = limited.invoke({ modelId: "model", input: "queued", signal: controller.signal });
    const third = limited.invoke({ modelId: "model", input: "third" });
    await flush();

    controller.abort();
    await expect(queued).rejects.toMatchObject({ name: "AbortError" });

    inner.releases.shift()?.();
    await flush();
    inner.releases.shift()?.();

    await expect(first).resolves.toEqual({ output: "first" });
    await expect(third).resolves.toEqual({ output: "third" });
  });

  it("rejects an invalid limit", () => {
    expect(() => new ConcurrencyLimitedProviderAdapter(deferredAdapter().adapter, 0)).toThrow(
      RangeError,
    );
  });
});
