import { describe, expect, it } from "vitest";

import { classifyTaskMode } from "./task-mode-classifier";

describe("classifyTaskMode", () => {
  it.each([
    ["Hi guys, how are you?", "simple"],
    ["Hi, how are you today?", "simple"],
    ["What should I cook today?", "simple"],
    ["Write a short thank-you note to my landlord.", "simple"],
    ["What is the latest news about solar panels?", "research"],
    ["Find sources on intermittent fasting.", "research"],
    ["Why did NVIDIA stock fall yesterday?", "deep"],
    ["Compare these two job offers and verify the salary claims.", "deep"],
    ["Everyone go and check the world.", "deep"],
  ] as const)("classifies %j as %s", (command, mode) => {
    expect(classifyTaskMode(command).mode).toBe(mode);
  });

  it("explains its choice", () => {
    expect(classifyTaskMode("Hello").reason).toMatch(/directly/);
  });
});
