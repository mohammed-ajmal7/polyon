import type { AgentId } from "../agent/ids";
import type { EvidenceId } from "./ids";

export interface FindingEvidenceRef {
  readonly evidenceId: EvidenceId;
  readonly sourceId: string;
  readonly locator?: string;
  readonly excerpt?: string;
  readonly relevance?: number;
}

export type FindingDisposition =
  | "SUPPORTED"
  | "CONTRADICTED"
  | "UNRESOLVED"
  | "INFERRED";

export interface Finding {
  readonly id: string;
  readonly agentId: AgentId;
  readonly claim: string;
  readonly evidence: readonly FindingEvidenceRef[];
  readonly confidence: number;
  readonly assumptions: readonly string[];
  readonly counterarguments: readonly string[];
  readonly disposition: FindingDisposition;
  readonly createdAt: string;
}