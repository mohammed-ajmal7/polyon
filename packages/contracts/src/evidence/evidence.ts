import type { AgentId } from "../agent/ids";
import type { EvidenceId, SourceId } from "./ids";

export interface EvidenceQuality {
  readonly authority: number;
  readonly directness: number;
  readonly recency: number;
  readonly independence: number;
  readonly corroboration: number;
  readonly specificity: number;
  readonly contradictionPenalty: number;
  readonly score: number;
}

export type EvidenceKind =
  "SUPPORTING" | "CONTRADICTING" | "CONTEXTUAL" | "OBSERVATIONAL" | "OTHER";

export interface Evidence {
  readonly id: EvidenceId;
  readonly sourceId: SourceId;
  readonly agentId?: AgentId;

  readonly kind: EvidenceKind;

  readonly claim: string;
  readonly supportingContent: string;
  readonly context?: string;
  readonly missionId?: string;
  readonly taskId?: string;

  readonly quality?: EvidenceQuality;
  readonly capturedAt: string;
}
