import type { ActionKind } from "../policy/risk";
import type { ToolId } from "./ids";

export type ToolKind =
  | "FILESYSTEM"
  | "TERMINAL"
  | "NETWORK"
  | "GIT"
  | "ARTIFACT"
  | "COMMUNICATION"
  | "OTHER";

export interface ToolInputSchema {
  readonly type?: "object" | "array" | "string" | "number" | "integer" | "boolean" | "null";
  readonly properties?: Readonly<Record<string, ToolInputSchema>>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean;
  readonly items?: ToolInputSchema;
  readonly enum?: readonly unknown[];
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly minItems?: number;
  readonly maxItems?: number;
}

export interface Tool {
  readonly id: ToolId;
  readonly name: string;
  readonly description: string;
  readonly kind: ToolKind;
  readonly actionKinds: readonly ActionKind[];
  readonly inputSchema?: ToolInputSchema;
  readonly enabled: boolean;
}
