import type { SourceId } from "./ids";

export type SourceKind =
  | "WEB"
  | "DOCUMENT"
  | "DATABASE"
  | "FILE"
  | "MESSAGE"
  | "API"
  | "USER_PROVIDED"
  | "AGENT_GENERATED"
  | "OTHER";

export interface Source {
  readonly id: SourceId;
  readonly kind: SourceKind;
  readonly title: string;
  readonly locator: string;
  readonly retrievedAt?: string;
}
