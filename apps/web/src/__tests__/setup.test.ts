import { describe, expect, it } from "vitest";

describe("Vitest setup", () => {
  it("runs a basic test", () => {
    expect(2 + 2).toBe(4);
  });

  it("has a jsdom environment", () => {
    const element = document.createElement("div");

    element.textContent = "POLYON";

    expect(element).toHaveTextContent("POLYON");
  });
});
