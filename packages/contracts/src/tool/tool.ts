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

export interface Tool {
  readonly id: ToolId;
  readonly name: string;
  readonly description: string;
  readonly kind: ToolKind;
  readonly actionKinds: readonly ActionKind[];
  readonly enabled: boolean;
}
