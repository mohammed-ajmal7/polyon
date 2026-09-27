import type { Tool, ToolInputSchema } from "@polyon/contracts";

export type ToolInputValidationErrorKind = "INVALID_INPUT" | "INVALID_SCHEMA";

export class ToolInputValidationError extends Error {
  readonly kind: ToolInputValidationErrorKind;
  readonly path: string;

  constructor(kind: ToolInputValidationErrorKind, path: string, message: string) {
    super(message);
    this.name = "ToolInputValidationError";
    this.kind = kind;
    this.path = path;
  }
}

export function validateToolInput(tool: Tool, input: unknown): void {
  if (tool.inputSchema === undefined) {
    return;
  }

  validateSchema(tool.inputSchema, input, "$");
}

function validateSchema(schema: ToolInputSchema, value: unknown, path: string): void {
  if (schema.enum !== undefined && !schema.enum.some((candidate) => deepEqual(candidate, value))) {
    throw new ToolInputValidationError(
      "INVALID_INPUT",
      path,
      `Value at ${path} is not one of the allowed enum values.`,
    );
  }

  switch (schema.type) {
    case "object": {
      if (!isRecord(value)) {
        throw invalidType(path, "object");
      }

      const required = schema.required ?? [];
      for (const property of required) {
        if (!(property in value)) {
          throw new ToolInputValidationError(
            "INVALID_INPUT",
            `${path}.${property}`,
            `Required property is missing: ${path}.${property}.`,
          );
        }
      }

      if (schema.additionalProperties === false && schema.properties !== undefined) {
        for (const key of Object.keys(value)) {
          if (!(key in schema.properties)) {
            throw new ToolInputValidationError(
              "INVALID_INPUT",
              `${path}.${key}`,
              `Unexpected property: ${path}.${key}.`,
            );
          }
        }
      }

      for (const [key, childSchema] of Object.entries(schema.properties ?? {})) {
        if (key in value) {
          validateSchema(childSchema, value[key], `${path}.${key}`);
        }
      }
      return;
    }

    case "array": {
      if (!Array.isArray(value)) {
        throw invalidType(path, "array");
      }
      if (schema.minItems !== undefined && value.length < schema.minItems) {
        throw new ToolInputValidationError(
          "INVALID_INPUT",
          path,
          `Array at ${path} must contain at least ${schema.minItems} item(s).`,
        );
      }
      if (schema.maxItems !== undefined && value.length > schema.maxItems) {
        throw new ToolInputValidationError(
          "INVALID_INPUT",
          path,
          `Array at ${path} must contain at most ${schema.maxItems} item(s).`,
        );
      }
      if (schema.items !== undefined) {
        value.forEach((item, index) => {
          validateSchema(schema.items!, item, `${path}[${index}]`);
        });
      }
      return;
    }

    case "string": {
      if (typeof value !== "string") {
        throw invalidType(path, "string");
      }
      if (schema.minLength !== undefined && value.length < schema.minLength) {
        throw new ToolInputValidationError(
          "INVALID_INPUT",
          path,
          `String at ${path} must be at least ${schema.minLength} character(s).`,
        );
      }
      if (schema.maxLength !== undefined && value.length > schema.maxLength) {
        throw new ToolInputValidationError(
          "INVALID_INPUT",
          path,
          `String at ${path} must be at most ${schema.maxLength} character(s).`,
        );
      }
      return;
    }

    case "number":
      validateNumber(path, value, schema, false);
      return;

    case "integer":
      validateNumber(path, value, schema, true);
      return;

    case "boolean":
      if (typeof value !== "boolean") {
        throw invalidType(path, "boolean");
      }
      return;

    case "null":
      if (value !== null) {
        throw invalidType(path, "null");
      }
      return;

    default:
      return;
  }
}

function validateNumber(
  path: string,
  value: unknown,
  schema: ToolInputSchema,
  integer: boolean,
): void {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    (integer && !Number.isInteger(value))
  ) {
    throw invalidType(path, integer ? "integer" : "number");
  }
  if (schema.minimum !== undefined && value < schema.minimum) {
    throw new ToolInputValidationError(
      "INVALID_INPUT",
      path,
      `Number at ${path} must be at least ${schema.minimum}.`,
    );
  }
  if (schema.maximum !== undefined && value > schema.maximum) {
    throw new ToolInputValidationError(
      "INVALID_INPUT",
      path,
      `Number at ${path} must be at most ${schema.maximum}.`,
    );
  }
}

function invalidType(path: string, expected: string): ToolInputValidationError {
  return new ToolInputValidationError("INVALID_INPUT", path, `Expected ${expected} at ${path}.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }

  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length && left.every((value, index) => deepEqual(value, right[index]))
    );
  }

  if (isRecord(left) && isRecord(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every(
        (key) =>
          Object.prototype.hasOwnProperty.call(right, key) && deepEqual(left[key], right[key]),
      )
    );
  }

  return false;
}
