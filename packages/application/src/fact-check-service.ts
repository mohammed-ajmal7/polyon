import type { AgentId, Evidence } from "@polyon/contracts";
import type { AgentGateway, AgentRegistry } from "@polyon/agents";
import type { DomainUnitOfWork, EventStore, EvidenceStore, SourceStore } from "@polyon/storage";
import { rankEvidenceQuality, type EvidenceQualityAssessment } from "./evidence-quality-service";

const MAX_CLAIMS = 20;
const MAX_EVIDENCE_PER_CLAIM = 20;
const MAX_CONTEXT_CHARACTERS = 60_000;
const MAX_RATIONALE_CHARACTERS = 8_000;

export type FactCheckVerdict = "SUPPORTED" | "CONTRADICTED" | "UNRESOLVED";

export interface FactCheckClaim {
  readonly id: string;
  readonly claim: string;
  readonly evidenceIds: readonly string[];
}

export interface FactCheckResult {
  readonly claimId: string;
  readonly claim: string;
  readonly verdict: FactCheckVerdict;
  readonly confidence?: number;
  readonly rationale: string;
  readonly evidenceIds: readonly string[];
  readonly evidenceQuality: readonly EvidenceQualityAssessment[];
}

export interface ExecuteFactCheckInput {
  readonly runId?: string;
  readonly factCheckerAgentId: AgentId;
  readonly claims: readonly FactCheckClaim[];
  readonly requiredCapabilityIds: readonly string[];
  readonly now?: () => string;
  readonly signal?: AbortSignal;
}

export interface FactCheckServiceDependencies {
  readonly agents: AgentRegistry;
  readonly agentGateway: AgentGateway;
  readonly evidence: EvidenceStore;
  readonly sources: SourceStore;
  readonly events: EventStore;
  readonly unitOfWork?: DomainUnitOfWork;
}

export class FactCheckService {
  constructor(private readonly dependencies: FactCheckServiceDependencies) {}

  async execute(input: ExecuteFactCheckInput): Promise<readonly FactCheckResult[]> {
    this.validateInput(input);
    const now = input.now ?? (() => new Date().toISOString());
    const agent = this.dependencies.agents.get(input.factCheckerAgentId);

    if (agent === undefined || agent.status !== "ACTIVE") {
      throw new Error(`Fact Checker agent is not active: ${input.factCheckerAgentId}.`);
    }

    const workspace = this.buildWorkspace(input.claims, now());
    this.persistEvent({
      id: `FACT_CHECK_STARTED:${input.runId ?? "no-run"}:${input.factCheckerAgentId}:${now()}`,
      kind: "FACT_CHECK_STARTED",
      actorId: input.factCheckerAgentId,
      agentRunId: input.runId,
      occurredAt: now(),
      data: {
        runId: input.runId,
        factCheckerAgentId: input.factCheckerAgentId,
        claimIds: input.claims.map((claim) => claim.id),
      },
    });

    const response = await this.dependencies.agentGateway.invokeText({
      agentId: input.factCheckerAgentId,
      runId: input.runId,
      requiredCapabilityIds: input.requiredCapabilityIds,
      request: {
        messages: [
          {
            role: "SYSTEM",
            content:
              "You are POLYON's Fact Checker. Verify each claim only against the supplied evidence. " +
              "Do not use agent agreement as proof and do not invent missing evidence. " +
              "Return a JSON array with claimId, verdict (SUPPORTED|CONTRADICTED|UNRESOLVED), " +
              "confidence (0..1), rationale, and evidenceIds.",
          },
          {
            role: "USER",
            content:
              `Claims to verify:\n${formatClaims(input.claims)}\n\nEvidence workspace:\n${workspace}` +
              "\n\nReturn one verdict per claim.",
          },
        ],
      },
      ...(input.signal === undefined ? {} : { modelOptions: { signal: input.signal } }),
    });

    const results = parseFactCheckResponse(
      response.output.content,
      input.claims,
      workspaceEvidence(input.claims, this.dependencies.evidence),
      this.dependencies.sources,
      now(),
    );

    for (const result of results) {
      this.persistEvent({
        id: `FACT_CHECK_RESULT:${input.runId ?? "no-run"}:${result.claimId}`,
        kind: "FACT_CHECK_RESULT",
        actorId: input.factCheckerAgentId,
        agentRunId: input.runId,
        occurredAt: now(),
        data: {
          runId: input.runId,
          claimId: result.claimId,
          verdict: result.verdict,
          confidence: result.confidence,
          rationale: result.rationale,
          evidenceIds: [...result.evidenceIds],
          evidenceQuality: result.evidenceQuality.map((item) => ({
            evidenceId: item.evidenceId,
            score: item.score,
            band: item.band,
          })),
        },
      });
    }

    this.persistEvent({
      id: `FACT_CHECK_COMPLETED:${input.runId ?? "no-run"}:${input.factCheckerAgentId}:${now()}`,
      kind: "FACT_CHECK_COMPLETED",
      actorId: input.factCheckerAgentId,
      agentRunId: input.runId,
      occurredAt: now(),
      data: {
        runId: input.runId,
        factCheckerAgentId: input.factCheckerAgentId,
        checkedClaimCount: results.length,
      },
    });

    return results;
  }

  private buildWorkspace(claims: readonly FactCheckClaim[], now: string): string {
    const allEvidence = workspaceEvidence(claims, this.dependencies.evidence);
    const sourceMap = new Map(
      this.dependencies.sources.list().map((source) => [source.id, source]),
    );
    const ranked = rankEvidenceQuality(allEvidence, sourceMap, now);
    const rankedById = new Map(ranked.map((item) => [item.evidenceId, item]));
    const lines: string[] = [];
    let used = 0;

    for (const item of allEvidence) {
      const quality = rankedById.get(item.id);
      const source = sourceMap.get(item.sourceId);
      const line =
        `[evidence:${item.id} source:${item.sourceId} quality:${quality?.score ?? 0}/${quality?.band ?? "LOW"}] ` +
        `${item.kind}: ${item.claim}\n${item.supportingContent}` +
        (source?.locator === undefined ? "" : `\nlocator: ${source.locator}`);
      if (used + line.length + 2 > MAX_CONTEXT_CHARACTERS) break;
      lines.push(line);
      used += line.length + 2;
    }

    return lines.join("\n\n");
  }

  private validateInput(input: ExecuteFactCheckInput): void {
    if (input.claims.length === 0 || input.claims.length > MAX_CLAIMS) {
      throw new RangeError(`Fact check requires 1-${MAX_CLAIMS} claims.`);
    }
    const ids = new Set<string>();
    for (const claim of input.claims) {
      if (claim.id.trim() === "" || claim.claim.trim() === "") {
        throw new RangeError("Fact check claim ids and text must not be empty.");
      }
      if (ids.has(claim.id)) throw new Error(`Duplicate fact check claim id: ${claim.id}.`);
      ids.add(claim.id);
      if (claim.evidenceIds.length > MAX_EVIDENCE_PER_CLAIM) {
        throw new RangeError(`Fact check claim ${claim.id} exceeds ${MAX_EVIDENCE_PER_CLAIM} evidence references.`);
      }
    }
  }

  private persistEvent(event: Parameters<EventStore["append"]>[0]): void {
    const operation = (stores: { readonly events: EventStore }) => {
      if (stores.events.get(event.id) === undefined) stores.events.append(event);
    };
    if (this.dependencies.unitOfWork === undefined) operation(this.dependencies);
    else this.dependencies.unitOfWork.transaction(operation);
  }
}

function workspaceEvidence(
  claims: readonly FactCheckClaim[],
  evidence: EvidenceStore,
): readonly Evidence[] {
  const ids = new Set(claims.flatMap((claim) => claim.evidenceIds));
  return evidence.list().filter((item) => ids.has(item.id));
}

function formatClaims(claims: readonly FactCheckClaim[]): string {
  return claims.map((claim) => `[claim:${claim.id}] ${claim.claim}\nEvidence: ${claim.evidenceIds.join(", ")}`).join("\n");
}

function parseFactCheckResponse(
  content: string,
  claims: readonly FactCheckClaim[],
  evidence: readonly Evidence[],
  sources: SourceStore,
  now: string,
): readonly FactCheckResult[] {
  const parsed = parseArray(content);
  if (parsed === undefined) {
    return claims.map((claim) => fallbackResult(claim, evidence, sources, now));
  }

  const claimMap = new Map(claims.map((claim) => [claim.id, claim]));
  const evidenceMap = new Map(evidence.map((item) => [item.id, item]));
  const results: FactCheckResult[] = [];

  for (const item of parsed) {
    const claimId = stringValue(item.claimId);
    const verdict = verdictValue(item.verdict);
    const rationale = stringValue(item.rationale);
    const confidence = numberValue(item.confidence);
    const claim = claimId === undefined ? undefined : claimMap.get(claimId);
    const evidenceIds = stringArray(item.evidenceIds);
    if (
      claim === undefined ||
      verdict === undefined ||
      rationale === undefined ||
      confidence === undefined ||
      evidenceIds === undefined ||
      evidenceIds.some((id) => !evidenceMap.has(id))
    ) continue;

    const allowed = new Set(claim.evidenceIds);
    if (evidenceIds.some((id) => !allowed.has(id))) continue;

    const selectedEvidence = evidenceIds
      .map((id) => evidenceMap.get(id))
      .filter((item): item is Evidence => item !== undefined);
    const sourceMap = new Map(sources.list().map((source) => [source.id, source]));
    const quality = rankEvidenceQuality(selectedEvidence, sourceMap, now);

    results.push({
      claimId: claim.id,
      claim: claim.claim,
      verdict,
      confidence,
      rationale: rationale.slice(0, MAX_RATIONALE_CHARACTERS),
      evidenceIds,
      evidenceQuality: quality,
    });
  }

  const existing = new Set(results.map((result) => result.claimId));
  for (const claim of claims) {
    if (!existing.has(claim.id)) results.push(fallbackResult(claim, evidence, sources, now));
  }
  return results;
}

function fallbackResult(
  claim: FactCheckClaim,
  evidence: readonly Evidence[],
  sources: SourceStore,
  now: string,
): FactCheckResult {
  const selected = evidence.filter((item) => claim.evidenceIds.includes(item.id));
  const sourceMap = new Map(sources.list().map((source) => [source.id, source]));
  const quality = rankEvidenceQuality(selected, sourceMap, now);
  return {
    claimId: claim.id,
    claim: claim.claim,
    verdict: "UNRESOLVED",
    rationale: "The Fact Checker did not return a valid verdict for this claim.",
    evidenceIds: selected.map((item) => item.id),
    evidenceQuality: quality,
  };
}

function parseArray(content: string): readonly Record<string, unknown>[] | undefined {
  const start = content.indexOf("[");
  const end = content.lastIndexOf("]");
  if (start < 0 || end <= start) return undefined;
  try {
    const value: unknown = JSON.parse(content.slice(start, end + 1));
    return Array.isArray(value) && value.every(isRecord) ? value : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? value : undefined;
}

function stringArray(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) return undefined;
  return [...new Set(value.map((item) => item.trim()).filter(Boolean))];
}

function verdictValue(value: unknown): FactCheckVerdict | undefined {
  if (value === "SUPPORTED" || value === "CONTRADICTED" || value === "UNRESOLVED") return value;
  return undefined;
}