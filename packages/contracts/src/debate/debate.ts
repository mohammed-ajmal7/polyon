import type { AgentId } from "../agent/ids";
import type { DebateId } from "./ids";

export type DebateStatus = "DRAFT" | "RUNNING" | "ADJUDICATING" | "DECIDED" | "CANCELLED";

export type DebatePhase = "PROPOSAL" | "CRITICISM" | "EVIDENCE" | "REBUTTAL" | "ADJUDICATION";

export interface Debate {
  readonly id: DebateId;
  readonly objective: string;
  readonly participantAgentIds: readonly AgentId[];
  readonly maxParticipants: number;
  readonly maxRounds: number;
  readonly currentRound: number;
  readonly phase: DebatePhase;
  readonly status: DebateStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly decidedAt?: string;
}
