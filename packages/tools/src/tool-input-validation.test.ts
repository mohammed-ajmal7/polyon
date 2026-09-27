import type { Tool } from "@polyon/contracts";
import { describe, expect, it } from "vitest";

import { ToolInputValidationError, validateToolInput } from "./tool-input-validation";

const tool: Tool = {
  id: "filesystem.read.scoped",
  name: "Scoped filesystem read",
  description: "Reads a bounded file.",
  kind: "FILESYSTEM",
  actionKinds: ["READ"],
  inputSchema: {
    type: "object",
    required: ["path"],
    additionalProperties: false,
    properties: {
      path: {
        type: "string",
        minLength: 1,
      },
      maxBytes: {
        type: "integer",
        minimum: 1,
      },
    },
  },
  enabled: true,
};

describe("validateToolInput", () => {
  it("accepts valid structured input", () => {
    expect(() =>
      validateToolInput(tool, {
        path: "notes.txt",
        maxBytes: 1024,
      }),
    ).not.toThrow();
  });

  it("rejects missing required properties", () => {
    expect(() => validateToolInput(tool, {})).toThrowError(
      expect.objectContaining({
        kind: "INVALID_INPUT",
        path: "$.path",
      }),
    );
  });

  it("rejects unexpected properties", () => {
    expect(() =>
      validateToolInput(tool, {
        path: "notes.txt",
        dangerous: true,
      }),
    ).toThrowError(ToolInputValidationError);
  });

  it("rejects invalid scalar values", () => {
    expect(() =>
      validateToolInput(tool, {
        path: "",
      }),
    ).toThrow("at least 1 character");

    expect(() =>
      validateToolInput(tool, {
        path: "notes.txt",
        maxBytes: 0,
      }),
    ).toThrow("at least 1");
  });

  it("skips validation when no schema is declared", () => {
    expect(() =>
      validateToolInput(
        {
          ...tool,
          inputSchema: undefined,
        },
        { arbitrary: "value" },
      ),
    ).not.toThrow();
  });
});
