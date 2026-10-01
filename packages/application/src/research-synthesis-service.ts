import type { AgentId, Evidence, MemoryEntry, Source } from "@polyon/contracts";

import { buildAgentRolePrompt, type AgentGateway } from "@polyon/agents";

import { rankEvidenceQuality } from "./evidence-quality-service";
import type {
  DomainStoreTransactionContext,
  DomainUnitOfWork,
  EventStore,
  EvidenceStore,
  MemoryStore,
  SourceStore,
} from "@polyon/storage";

const MAX_CONTEXT_CHARS = 60_000;
const MAX_REPORT_CHARS = 100_000;

export interface SynthesizeResearchInput {
  readonly query: string;
  readonly agentId: AgentId;
  readonly requiredCapabilityIds: readonly string[];
  readonly now: string;
  readonly memoryId: string;
  readonly missionId?: string;
  readonly taskId?: string;
}

export interface ResearchSynthesisResult {
  readonly report: string;
  readonly memory: MemoryEntry;
  readonly sources: readonly Source[];
  readonly evidence: readonly Evidence[];
  readonly quality: readonly ReturnType<typeof rankEvidenceQuality>[number][];
}

export class ResearchSynthesisService {
  constructor(
    private readonly agentGateway: AgentGateway,
    private readonly sources: SourceStore,
    private readonly evidence: EvidenceStore,
    private readonly memory: MemoryStore,
    private readonly events: EventStore,
    private readonly unitOfWork?: DomainUnitOfWork,
  ) {}

  async synthesize(input: SynthesizeResearchInput): Promise<ResearchSynthesisResult> {
    const query = input.query.trim();
    if (query === "") throw new RangeError("Research synthesis query must not be empty.");

    const evidence = this.evidence.list();
    const sourcesById = new Map(this.sources.list().map((source) => [source.id, source]));
    const selected = evidence
      .filter((item) => input.missionId === undefined || item.missionId === input.missionId)
      .filter((item) => input.taskId === undefined || item.taskId === input.taskId)
      .slice(-200);
    const quality = rankEvidenceQuality(selected, sourcesById, input.now);
    const qualityByEvidenceId = new Map(
      quality.map((assessment) => [assessment.evidenceId, assessment]),
    );
    const rankedEvidence = [...selected].sort(
      (left, right) =>
        (qualityByEvidenceId.get(right.id)?.score ?? 0) -
          (qualityByEvidenceId.get(left.id)?.score ?? 0) ||
        right.capturedAt.localeCompare(left.capturedAt) ||
        left.id.localeCompare(right.id),
    );

    const context = formatEvidenceContext(rankedEvidence, sourcesById, qualityByEvidenceId);
    const response = await this.agentGateway.invokeText({
      agentId: input.agentId,
      requiredCapabilityIds: input.requiredCapabilityIds,
      request: {
        messages: [
          {
            role: "SYSTEM",
            content:
              "You are POLYON's research synthesizer. Produce an evidence-grounded report. " +
              "Separate supported findings, contradictions, uncertainty, and unanswered questions. " +
              "Cite sources by their provided source IDs. Never invent evidence.\n" +
              buildAgentRolePrompt(undefined, "synthesis", "synthesizer"),
          },
          {
            role: "USER",
            content: `Research question: ${query}\n\nEvidence:\n${context}`,
          },
        ],
      },
    });

    const report = response.output.content.trim().slice(0, MAX_REPORT_CHARS);
    if (report === "") throw new Error("Research synthesis returned an empty report.");

    const memory: MemoryEntry = {
      id: input.memoryId,
      kind: "SUMMARY",
      scope: input.missionId === undefined ? "PRIVATE" : "MISSION",
      text: report,
      tags: ["research", "synthesis"],
      sourceIds: selected.map((item) => item.sourceId),
      ...(input.missionId === undefined ? {} : { missionId: input.missionId }),
      ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
      createdAt: input.now,
      updatedAt: input.now,
    };

    const operation = (stores: Pick<DomainStoreTransactionContext, "memory" | "events">) => {
      if (stores.memory.get(memory.id) !== undefined) {
        throw new Error(`Research synthesis memory already exists: ${memory.id}.`);
      }

      stores.memory.save(memory);
      stores.events.append({
        id: `RESEARCH_SYNTHESIZED:${memory.id}`,
        kind: "RESEARCH_SYNTHESIZED",
        missionId: input.missionId,
        taskId: input.taskId,
        occurredAt: input.now,
        data: {
          memoryId: memory.id,
          evidenceCount: selected.length,
          sourceIds: [...new Set(selected.map((item) => item.sourceId))],
          evidenceQuality: quality.map((assessment) => ({
            evidenceId: assessment.evidenceId,
            score: assessment.score,
            band: assessment.band,
          })),
        },
      });
    };

    if (this.unitOfWork === undefined) {
      operation({ memory: this.memory, events: this.events });
    } else {
      this.unitOfWork.transaction(operation);
    }

    return {
      report,
      memory,
      sources: selected
        .map((item) => sourcesById.get(item.sourceId))
        .filter((source): source is Source => source !== undefined),
      evidence: rankedEvidence,
      quality,
    };
  }
}

function formatEvidenceContext(
  evidence: readonly Evidence[],
  sources: ReadonlyMap<string, Source>,
  qualityByEvidenceId: ReadonlyMap<string, ReturnType<typeof rankEvidenceQuality>[number]>,
): string {
  const lines: string[] = [];
  let total = 0;

  for (const item of evidence) {
    const source = sources.get(item.sourceId);
    const quality = qualityByEvidenceId.get(item.id);
    const line =
      `[evidence:${item.id} source:${item.sourceId} ${source?.title ?? "unknown"} quality:${quality?.score ?? 0}]` +
      ` ${item.kind}: ${item.claim}\n${item.supportingContent}`;
    if (total + line.length > MAX_CONTEXT_CHARS) break;
    lines.push(line);
    total += line.length + 2;
  }

  return lines.join("\n\n");
}
