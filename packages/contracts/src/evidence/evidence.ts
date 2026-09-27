import type { EvidenceId, SourceId } from "./ids";

export type EvidenceKind =
  "SUPPORTING" | "CONTRADICTING" | "CONTEXTUAL" | "OBSERVATIONAL" | "OTHER";

export interface Evidence {
  readonly id: EvidenceId;
  readonly sourceId: SourceId;

  readonly kind: EvidenceKind;

  readonly claim: string;
  readonly supportingContent: string;
  readonly context?: string;
  readonly missionId?: string;
  readonly taskId?: string;

  readonly capturedAt: string;
}
