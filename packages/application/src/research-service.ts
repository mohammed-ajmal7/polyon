import type { Evidence, EvidenceKind, Source, SourceKind } from "@polyon/contracts";
import { buildEvidenceQuality } from "@polyon/core";
import type {
  DomainStoreTransactionContext,
  DomainUnitOfWork,
  EventStore,
  EvidenceStore,
  SourceStore,
} from "@polyon/storage";

export interface ResearchSourceCandidate {
  readonly title: string;
  readonly locator: string;
  readonly kind: SourceKind;
  readonly content: string;
  readonly claim?: string;
  readonly context?: string;
  readonly evidenceKind?: EvidenceKind;
  readonly retrievedAt: string;
}

export interface ResearchRetriever {
  search(
    query: string,
    options: { readonly limit: number; readonly signal?: AbortSignal },
  ): Promise<readonly ResearchSourceCandidate[]>;
}

export interface ConductResearchInput {
  readonly query: string;
  readonly sourceLimit?: number;
  readonly actorId?: string;
  readonly agentId?: string;
  readonly missionId?: string;
  readonly taskId?: string;
  readonly sourceIdFactory: (index: number, candidate: ResearchSourceCandidate) => string;
  readonly evidenceIdFactory: (index: number, candidate: ResearchSourceCandidate) => string;
  readonly now: string;
  readonly signal?: AbortSignal;
}

export interface ConductResearchResult {
  readonly sources: readonly Source[];
  readonly evidence: readonly Evidence[];
}

export class ResearchService {
  constructor(
    private readonly retriever: ResearchRetriever,
    private readonly sources: SourceStore,
    private readonly evidence: EvidenceStore,
    private readonly events: EventStore,
    private readonly unitOfWork?: DomainUnitOfWork,
  ) {}

  async conduct(input: ConductResearchInput): Promise<ConductResearchResult> {
    const query = input.query.trim();
    if (query === "") throw new RangeError("Research query must not be empty.");

    const limit = input.sourceLimit ?? 5;
    if (!Number.isInteger(limit) || limit <= 0 || limit > 20) {
      throw new RangeError("Research sourceLimit must be an integer between 1 and 20.");
    }

    const candidates = await this.retriever.search(query, { limit, signal: input.signal });
    const operation = (
      stores: Pick<DomainStoreTransactionContext, "sources" | "evidence" | "events">,
    ) => {
      const createdSources: Source[] = [];
      const createdEvidence: Evidence[] = [];

      for (let index = 0; index < candidates.length; index += 1) {
        const candidate = candidates[index]!;
        validateCandidate(candidate);

        const source: Source = {
          id: input.sourceIdFactory(index, candidate),
          kind: candidate.kind,
          title: candidate.title.trim(),
          locator: candidate.locator,
          retrievedAt: candidate.retrievedAt,
        };
        const evidence: Evidence = {
          id: input.evidenceIdFactory(index, candidate),
          sourceId: source.id,
          ...(input.agentId === undefined ? {} : { agentId: input.agentId }),
          kind: candidate.evidenceKind ?? "SUPPORTING",
          claim: candidate.claim?.trim() || query,
          supportingContent: candidate.content,
          ...(candidate.context === undefined ? {} : { context: candidate.context }),
          ...(input.missionId === undefined ? {} : { missionId: input.missionId }),
          ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
          capturedAt: input.now,
        };

        if (stores.sources.get(source.id) !== undefined) {
          throw new Error(`Source already exists: ${source.id}.`);
        }
        if (stores.evidence.get(evidence.id) !== undefined) {
          throw new Error(`Evidence already exists: ${evidence.id}.`);
        }

        createdSources.push(source);
        createdEvidence.push(evidence);
      }

      const sourcesById = new Map(createdSources.map((source) => [source.id, source]));
      const evidenceWithQuality = createdEvidence.map((item) => ({
        ...item,
        quality: buildEvidenceQuality(item, {
          evidence: createdEvidence,
          sources: sourcesById,
          now: input.now,
        }),
      }));

      for (let index = 0; index < createdSources.length; index += 1) {
        const source = createdSources[index]!;
        const evidence = evidenceWithQuality[index]!;

        stores.sources.save(source);
        stores.evidence.save(evidence);
        stores.events.append({
          id: `SOURCE_RETRIEVED:${source.id}`,
          kind: "SOURCE_RETRIEVED",
          actorId: input.actorId,
          missionId: input.missionId,
          taskId: input.taskId,
          occurredAt: source.retrievedAt ?? input.now,
          data: {
            sourceId: source.id,
            kind: source.kind,
            title: source.title,
            locator: source.locator,
          },
        });
        stores.events.append({
          id: `EVIDENCE_CAPTURED:${evidence.id}`,
          kind: "EVIDENCE_CAPTURED",
          actorId: input.actorId,
          missionId: input.missionId,
          taskId: input.taskId,
          occurredAt: evidence.capturedAt,
          data: {
            evidenceId: evidence.id,
            sourceId: evidence.sourceId,
            kind: evidence.kind,
            qualityScore: evidence.quality?.score,
          },
        });
      }

      return { sources: createdSources, evidence: evidenceWithQuality };
    };

    return this.unitOfWork === undefined
      ? operation({ sources: this.sources, evidence: this.evidence, events: this.events })
      : this.unitOfWork.transaction(operation);
  }
}

function validateCandidate(candidate: ResearchSourceCandidate): void {
  if (candidate.title.trim() === "")
    throw new RangeError("Research source title must not be empty.");
  if (candidate.locator.trim() === "")
    throw new RangeError("Research source locator must not be empty.");
  if (candidate.content.trim() === "")
    throw new RangeError("Research evidence content must not be empty.");
  if (candidate.content.length > 100_000)
    throw new RangeError("Research evidence content exceeds the 100000-character limit.");
  if (!Number.isFinite(Date.parse(candidate.retrievedAt))) {
    throw new RangeError("Research source retrievedAt must be a valid timestamp.");
  }
}
