import { afterEach, describe, expect, it } from "vitest";

import {
  BackgroundRunLimitError,
  MAX_ACTIVE_BACKGROUND_RUNS,
  getBackgroundRun,
  resetBackgroundRuns,
  startBackgroundRun,
} from "./run-registry";

async function settle(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}

afterEach(() => resetBackgroundRuns());

describe("background run registry", () => {
  it("reports a run as running, then stores its result", async () => {
    let finish: (value: unknown) => void = () => undefined;
    startBackgroundRun(
      { runId: "run-1", mode: "Collaborative" },
      () => new Promise((resolve) => (finish = resolve)),
    );
    await settle();
    expect(getBackgroundRun("run-1")).toMatchObject({ status: "running", mode: "Collaborative" });

    finish({ status: "SUCCEEDED" });
    await settle();
    expect(getBackgroundRun("run-1")).toMatchObject({
      status: "succeeded",
      result: { status: "SUCCEEDED" },
    });
    expect(getBackgroundRun("run-1")?.finishedAt).toEqual(expect.any(String));
  });

  it("records a failure message", async () => {
    startBackgroundRun({ runId: "run-2", mode: "Direct" }, () =>
      Promise.reject(new Error("model unavailable")),
    );
    await settle();
    expect(getBackgroundRun("run-2")).toMatchObject({
      status: "failed",
      error: "model unavailable",
    });
  });

  it("caps concurrent runs and rejects a duplicate running id", () => {
    const never = () => new Promise<unknown>(() => undefined);
    for (let index = 0; index < MAX_ACTIVE_BACKGROUND_RUNS; index += 1) {
      startBackgroundRun({ runId: `busy-${index}`, mode: "Direct" }, never);
    }
    expect(() => startBackgroundRun({ runId: "one-more", mode: "Direct" }, never)).toThrow(
      BackgroundRunLimitError,
    );
    expect(() => startBackgroundRun({ runId: "busy-0", mode: "Direct" }, never)).toThrow(
      BackgroundRunLimitError,
    );
  });
});
