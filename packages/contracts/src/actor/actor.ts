import type { ActorId } from "./ids";

export type ActorKind = "HUMAN" | "AGENT" | "SYSTEM" | "EXTERNAL";

export type ActorStatus = "ACTIVE" | "DISABLED";

export interface Actor {
  readonly id: ActorId;
  readonly kind: ActorKind;
  readonly name: string;
  readonly description: string;
  readonly status: ActorStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}
