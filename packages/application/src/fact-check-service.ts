import type { AgentId, Evidence, Source } from "@polyon/contracts";

import { buildAgentRolePrompt } from "@polyon/agents";
import type {
  DomainStoreTransactionContext,
  DomainUnitOfWork,
  EventStore,
  EvidenceStore,
  SourceStore,
} from "@polyon/storage";

import { rankEvidenceQuality } from "./evidence-quality-service";
import type { AgentGateway } from "@polyon/agents";

export type FactCheckStatus = "SUPPORTED" | "CONTRADICTED" | "UNRESOLVED";

export interface FactCheckClaim {
  readonly id: string;
  readonly text: string;
}

export interface FactCheckClaimResult {
  readonly id: string;
  readonly text: string;
  readonly status: FactCheckStatus;
  readonly supportingEvidenceIds: readonly string[];
  readonly contradictingEvidenceIds: readonly string[];
  readonly relevantEvidenceIds: readonly string[];
  readonly evidenceQualityScore: number;
  readonly modelAssessment?: string;
}

export interface RunFactCheckInput {
  readonly checkId: string;
  readonly agentId: AgentId;
  readonly claims: readonly FactCheckClaim[];
  readonly requiredCapabilityIds: readonly string[];
  readonly now: string;
  readonly missionId?: string;
  readonly taskId?: string;
}

export interface FactCheckResult {
  readonly checkId: string;
  readonly claims: readonly FactCheckClaimResult[];
}

export interface FactCheckServiceDependencies {
  readonly agentGateway: AgentGateway;
  readonly evidence: EvidenceStore;
  readonly sources: SourceStore;
  readonly events: EventStore;
  readonly unitOfWork?: DomainUnitOfWork;
}

const MAX_CLAIMS = 32;
const MAX_CLAIM_CHARS = 2_000;
const MAX_RELEVANT_EVIDENCE = 8;
const MAX_PROMPT_CHARS = 40_000;
const MAX_MODEL_ASSESSMENT_CHARS = 12_000;

export class FactCheckService {
  constructor(private readonly dependencies: FactCheckServiceDependencies) {}

  async run(input: RunFactCheckInput): Promise<FactCheckResult> {
    validateInput(input);

    const corpus = this.dependencies.evidence
      .list()
      .filter((item) => input.missionId === undefined || item.missionId === input.missionId)
      .filter((item) => input.taskId === undefined || item.taskId === input.taskId);

    const sources = new Map(this.dependencies.sources.list().map((source) => [source.id, source]));
    const quality = new Map(
      rankEvidenceQuality(corpus, sources, input.now).map((assessment) => [
        assessment.evidenceId,
        assessment,
      ]),
    );

    this.persistStarted(input);

    const claimResults: FactCheckClaimResult[] = [];
    for (const claim of input.claims) {
      const relevant = rankRelevantEvidence(claim.text, corpus, quality);
      const supportingEvidenceIds = relevant
        .filter((item) => item.entry.kind === "SUPPORTING")
        .map((item) => item.entry.id);
      const contradictingEvidenceIds = relevant
        .filter((item) => item.entry.kind === "CONTRADICTING")
        .map((item) => item.entry.id);

      const status: FactCheckStatus =
        contradictingEvidenceIds.length > 0 && supportingEvidenceIds.length === 0
          ? "CONTRADICTED"
          : supportingEvidenceIds.length > 0 && contradictingEvidenceIds.length === 0
            ? "SUPPORTED"
            : "UNRESOLVED";

      const modelAssessment = await this.reviewClaimWithAgent(
        input.agentId,
        claim,
        relevant,
        sources,
        input.requiredCapabilityIds,
        input.now,
      );

      claimResults.push({
        id: claim.id,
        text: claim.text,
        status,
        supportingEvidenceIds,
        contradictingEvidenceIds,
        relevantEvidenceIds: relevant.map((item) => item.entry.id),
        evidenceQualityScore:
          relevant.length === 0
            ? 0
            : Math.round(
                relevant.reduce(
                  (sum, item) => sum + (quality.get(item.entry.id)?.score ?? 0),
                  0,
                ) / relevant.length,
              ),
        ...(modelAssessment === undefined ? {} : { modelAssessment }),
      });
    }

    this.persistCompleted(input, claimResults);

    return {
      checkId: input.checkId,
      claims: claimResults,
    };
  }

  private async reviewClaimWithAgent(
    agentId: AgentId,
    claim: FactCheckClaim,
    relevant: readonly {
      entry: Evidence;
      source?: Source;
      score: number;
    }[],
    sources: ReadonlyMap<string, Source>,
    requiredCapabilityIds: readonly string[],
    now: string,
  ): Promise<string | undefined> {
    const context = relevant
      .map(
        (item) =>
          `[evidence:${item.entry.id} source:${item.entry.sourceId} ` +
          `quality:${Math.round(item.score)} ${item.source?.title ?? "unknown"}] ` +
          `${item.entry.kind}: ${item.entry.claim}\n${item.entry.supportingContent}`,
      )
      .join("\n\n")
      .slice(0, MAX_PROMPT_CHARS);

    const response = await this.dependencies.agentGateway.invokeText({
      agentId,
      requiredCapabilityIds,
      request: {
        messages: [
          {
            role: "SYSTEM",
            content:
              "You are POLYON's Fact Checker. Verify claims only against supplied evidence. " +
              "Return a concise assessment that distinguishes supported, contradicted, and unresolved parts. " +
              "Do not invent sources or external verification.\n" +
              buildAgentRolePrompt(undefined, "fact-check", "fact-checker"),
          },
          {
            role: "USER",
            content:
              `Claim: ${claim.text}\nRetrieved evidence:\n${context || "No relevant evidence was found."}` +
              `\nAs of: ${now}\nReturn the assessment.`,
          },
        ],
      },
    });

    const assessment = response.output.content.trim().slice(0, MAX_MODEL_ASSESSMENT_CHARS);
    return assessment === "" ? undefined : assessment;
  }

  private persistStarted(input: RunFactCheckInput): void {
    this.persistEvent({
      id: `FACT_CHECK_STARTED:${input.checkId}`,
      kind: "FACT_CHECK_STARTED",
      actorId: input.agentId,
      missionId: input.missionId,
      taskId: input.taskId,
      occurredAt: input.now,
      data: {
        checkId: input.checkId,
        claimCount: input.claims.length,
      },
    });
  }

  private persistCompleted(
    input: RunFactCheckInput,
    claims: readonly FactCheckClaimResult[],
  ): void {
    this.persistEvent({
      id: `FACT_CHECK_COMPLETED:${input.checkId}`,
      kind: "FACT_CHECK_COMPLETED",
      actorId: input.agentId,
      missionId: input.missionId,
      taskId: input.taskId,
      occurredAt: input.now,
      data: {
        checkId: input.checkId,
        claims: claims.map((claim) => ({
          id: claim.id,
          status: claim.status,
          relevantEvidenceIds: [...claim.relevantEvidenceIds],
          evidenceQualityScore: claim.evidenceQualityScore,
        })),
      },
    });
  }

  private persistEvent(event: {
    readonly id: string;
    readonly kind: "FACT_CHECK_STARTED" | "FACT_CHECK_COMPLETED";
    readonly actorId: AgentId;
    readonly missionId?: string;
    readonly taskId?: string;
    readonly occurredAt: string;
    readonly data: Readonly<Record<string, unknown>>;
  }): void {
    const operation = (
      stores: Pick<DomainStoreTransactionContext, "events">,
    ): void => {
      if (stores.events.get(event.id) === undefined) stores.events.append(event);
    };

    if (this.dependencies.unitOfWork === undefined) {
      operation({ events: this.dependencies.events });
      return;
    }

    this.dependencies.unitOfWork.transaction(operation);
  }
}

function rankRelevantEvidence(
  claim: string,
  evidence: readonly Evidence[],
  quality: ReadonlyMap<string, { readonly score: number }>,
): readonly {
  entry: Evidence;
  source?: Source;
  score: number;
}[] {
  const claimTokens = tokenize(claim);
  const ranked = evidence
    .map((entry) => {
      const overlap = overlapScore(claimTokens, tokenize(entry.claim + " " + entry.supportingContent));
      const qualityScore = quality.get(entry.id)?.score ?? 0;
      return {
        entry,
        score: overlap * 10 + qualityScore,
      };
    })
    .filter((item) => item.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.entry.id.localeCompare(right.entry.id),
    )
    .slice(0, MAX_RELEVANT_EVIDENCE);

  return ranked;
}

function overlapScore(left: readonly string[], right: readonly string[]): number {
  const rightTokens = new Set(right);
  return left.reduce((score, token) => score + (rightTokens.has(token) ? 1 : 0), 0);
}

function tokenize(value: string): string[] {
  return value
    .trim()
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/gu)
    .filter((token) => token.length >= 2);
}

function validateInput(input: RunFactCheckInput): void {
  if (input.checkId.trim() === "") throw new RangeError("Fact check id must not be empty.");
  if (!Number.isFinite(Date.parse(input.now))) throw new RangeError("Fact check now must be valid.");
  if (!Number.isInteger(input.claims.length) || input.claims.length < 1 || input.claims.length > MAX_CLAIMS) {
    throw new RangeError(`Fact check claims must contain between 1 and ${MAX_CLAIMS} items.`);
  }

  const ids = new Set<string>();
  for (const claim of input.claims) {
    if (
      claim.id.trim() === "" ||
      claim.text.trim() === "" ||
      claim.text.trim().length > MAX_CLAIM_CHARS
    ) {
      throw new RangeError(
        `Each fact check claim requires a bounded id and 1-${MAX_CLAIM_CHARS} characters of text.`,
      );
    }
    if (ids.has(claim.id)) throw new Error(`Duplicate fact check claim id: ${claim.id}.`);
    ids.add(claim.id);
  }
}
