import { describe, expect, it } from "vitest";

import { fitBlocksToBudget, fitRecentBlocksToBudget, truncateBlock } from "./context-budget";

describe("fitBlocksToBudget", () => {
  it("joins blocks unchanged when they fit", () => {
    expect(fitBlocksToBudget(["a", "", "b"], 100)).toBe("a\n\nb");
  });

  it("keeps later blocks when the first block alone exceeds the budget", () => {
    const result = fitBlocksToBudget(["x".repeat(50_000), "second", "third"], 1_000);

    expect(result.length).toBeLessThanOrEqual(1_000);
    expect(result).toContain("second");
    expect(result).toContain("third");
    expect(result).toContain("[... truncated");
  });

  it("gives oversized blocks a fair share of the remaining budget", () => {
    const blocks = Array.from({ length: 5 }, (_, index) => `[peer-${index}]` + "y".repeat(12_000));
    const result = fitBlocksToBudget(blocks, 50_000);

    expect(result.length).toBeLessThanOrEqual(50_000);
    for (let index = 0; index < 5; index += 1) expect(result).toContain(`[peer-${index}]`);
  });
});

describe("fitRecentBlocksToBudget", () => {
  it("prefers the most recent blocks and marks omitted older ones", () => {
    const blocks = Array.from({ length: 10 }, (_, index) => `entry-${index}:` + "z".repeat(100));
    const result = fitRecentBlocksToBudget(blocks, 400);

    expect(result.length).toBeLessThanOrEqual(400);
    expect(result).toContain("entry-9:");
    expect(result).not.toContain("entry-0:");
    expect(result).toMatch(/earlier entries omitted/u);
    expect(result.indexOf("entry-8:")).toBeLessThan(result.indexOf("entry-9:"));
  });

  it("truncates a single oversized block instead of returning nothing", () => {
    const result = fitRecentBlocksToBudget(["q".repeat(50_000)], 1_000);

    expect(result.length).toBeLessThanOrEqual(1_000);
    expect(result.startsWith("q")).toBe(true);
    expect(result).toContain("[... truncated");
  });
});

describe("truncateBlock", () => {
  it("never exceeds the limit", () => {
    for (const limit of [0, 1, 10, 40, 100]) {
      expect(truncateBlock("w".repeat(500), limit).length).toBeLessThanOrEqual(limit);
    }
  });
});
