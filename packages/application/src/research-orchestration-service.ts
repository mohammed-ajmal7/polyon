import { randomUUID } from "node:crypto";

import type {
  AgentId,
  DomainEvent,
  Evidence,
  Message,
  Source,
  TextModelRequest,
} from "@polyon/contracts";

import { buildAgentRolePrompt, type AgentGateway, type AgentRegistry } from "@polyon/agents";
import type {
  ConversationStore,
  DomainStoreTransactionContext,
  DomainUnitOfWork,
  EventStore,
  MessageStore,
} from "@polyon/storage";
import type { Finding } from "@polyon/contracts";

import { parseStructuredFinding } from "./structured-finding-parser";

import type { CommandIngressResult } from "./command-ingress";
import { fitBlocksToBudget } from "./context-budget";
import type { ResearchService } from "./research-service";

const DEFAULT_MAX_PARTICIPANTS = 8;
const MIN_PARTICIPANTS = 2;
const DEFAULT_SOURCE_LIMIT = 5;
const MAX_SOURCE_LIMIT = 20;
const MAX_FINDING_CHARACTERS = 12_000;
const MAX_CONTEXT_CHARACTERS = 60_000;

export interface ResearchTarget {
  readonly agentId: AgentId;
  readonly actorId: string;
}

export interface ExecuteResearchInput {
  readonly command: CommandIngressResult;
  readonly targets: readonly ResearchTarget[];
  readonly actorId: string;
  readonly requiredCapabilityIds: readonly string[];
  readonly synthesizerAgentId?: AgentId;
  readonly maxParticipants?: number;
  readonly sourceLimit?: number;
  readonly now?: () => string;
  readonly signal?: AbortSignal;
}

export interface ResearchFinding {
  readonly agentId: AgentId;
  readonly actorId: string;
  readonly role: string;
  readonly modelId: string;
  readonly providerId: string;
  readonly content: string;
  readonly sourceIds: readonly string[];
  readonly evidenceIds: readonly string[];
  readonly finding?: Finding;
}

export interface ResearchFailure {
  readonly agentId: AgentId;
  readonly actorId: string;
  readonly stage: "RESEARCH" | "ANALYSIS" | "SYNTHESIS";
  readonly error: string;
}

export type ResearchExecutionStatus = "SUCCEEDED" | "PARTIAL" | "FAILED";

export interface ResearchExecutionResult {
  readonly researchId: string;
  readonly conversationId: string;
  readonly status: ResearchExecutionStatus;
  readonly synthesizerAgentId: AgentId;
  readonly findings: readonly ResearchFinding[];
  readonly failures: readonly ResearchFailure[];
  readonly sourceIds: readonly string[];
  readonly evidenceIds: readonly string[];
  readonly synthesis?: Message;
}

interface ResearchContext {
  readonly sources: readonly Source[];
  readonly evidence: readonly Evidence[];
}

type ResearchStores = Pick<DomainStoreTransactionContext, "conversations" | "messages" | "events">;

export interface ResearchOrchestrationDependencies {
  readonly agents: AgentRegistry;
  readonly agentGateway: AgentGateway;
  readonly research: ResearchService;
  readonly conversations: ConversationStore;
  readonly messages: MessageStore;
  readonly events: EventStore;
  readonly unitOfWork?: DomainUnitOfWork;
}

export class ResearchOrchestrationService {
  constructor(private readonly dependencies: ResearchOrchestrationDependencies) {}

  async execute(input: ExecuteResearchInput): Promise<ResearchExecutionResult> {
    this.validateInput(input);

    const now = input.now ?? (() => new Date().toISOString());
    const targets = [...input.targets];
    const synthesizerAgentId = input.synthesizerAgentId ?? targets[targets.length - 1]!.agentId;
    const researchId = `research:${input.command.conversation.id}:${input.command.message.id}:${randomUUID()}`;
    const sourceLimit = input.sourceLimit ?? DEFAULT_SOURCE_LIMIT;

    const synthesizer = this.dependencies.agents.get(synthesizerAgentId);
    if (synthesizer === undefined || synthesizer.status !== "ACTIVE") {
      throw new Error(`Research synthesizer is not active: ${synthesizerAgentId}.`);
    }

    this.persistStart(researchId, input, synthesizerAgentId, sourceLimit, now());

    const contributors = targets.filter((target) => target.agentId !== synthesizerAgentId);
    const results = await Promise.all(
      contributors.map((target) =>
        this.executeResearcher(researchId, input, target, sourceLimit, now),
      ),
    );

    const findings = results
      .filter(
        (result): result is Extract<(typeof results)[number], { kind: "success" }> =>
          result.kind === "success",
      )
      .map((result) => result.finding);

    const failures = results
      .filter(
        (result): result is Extract<(typeof results)[number], { kind: "failure" }> =>
          result.kind === "failure",
      )
      .map((result) => result.failure);

    const researchContext = mergeResearchContext(
      results
        .filter(
          (result): result is Extract<(typeof results)[number], { kind: "success" }> =>
            result.kind === "success",
        )
        .map((result) => result.research),
    );

    if (findings.length === 0 && researchContext.evidence.length === 0) {
      const failure: ResearchFailure = {
        agentId: synthesizerAgentId,
        actorId: synthesizerAgentId,
        stage: "SYNTHESIS",
        error: "Research produced no usable findings or evidence.",
      };
      this.persistFailure(researchId, input, failure, now());

      return {
        researchId,
        conversationId: input.command.conversation.id,
        status: "FAILED",
        synthesizerAgentId,
        findings,
        failures: [...failures, failure],
        sourceIds: [],
        evidenceIds: [],
      };
    }

    let synthesis: Message | undefined;
    try {
      const response = await this.dependencies.agentGateway.invokeText({
        agentId: synthesizerAgentId,
        runId: researchId,
        requiredCapabilityIds: input.requiredCapabilityIds,
        request: this.buildSynthesisRequest(
          input.command.message.content,
          findings,
          failures,
          researchContext,
          buildAgentRolePrompt(this.dependencies.agents.get(synthesizerAgentId), "synthesis"),
        ),
        ...(input.signal === undefined ? {} : { modelOptions: { signal: input.signal } }),
      });

      const content = response.output.content.trim().slice(0, MAX_FINDING_CHARACTERS);
      if (content === "") throw new Error("Research synthesis returned empty content.");

      synthesis = this.persistSynthesis(
        researchId,
        input,
        synthesizerAgentId,
        content,
        response.modelId,
        response.providerId,
        now(),
      );
    } catch (error) {
      const failure: ResearchFailure = {
        agentId: synthesizerAgentId,
        actorId: synthesizerAgentId,
        stage: "SYNTHESIS",
        error: error instanceof Error ? error.message : "Research synthesis failed.",
      };
      this.persistFailure(researchId, input, failure, now());

      return {
        researchId,
        conversationId: input.command.conversation.id,
        status: "FAILED",
        synthesizerAgentId,
        findings,
        failures: [...failures, failure],
        sourceIds: researchContext.sources.map((source) => source.id),
        evidenceIds: researchContext.evidence.map((evidence) => evidence.id),
      };
    }

    this.persistCompletion(
      researchId,
      input,
      synthesizerAgentId,
      findings,
      failures,
      researchContext,
      synthesis.id,
      now(),
    );

    return {
      researchId,
      conversationId: input.command.conversation.id,
      status: failures.length === 0 ? "SUCCEEDED" : "PARTIAL",
      synthesizerAgentId,
      findings,
      failures,
      sourceIds: researchContext.sources.map((source) => source.id),
      evidenceIds: researchContext.evidence.map((evidence) => evidence.id),
      synthesis,
    };
  }

  private async executeResearcher(
    researchId: string,
    input: ExecuteResearchInput,
    target: ResearchTarget,
    sourceLimit: number,
    now: () => string,
  ): Promise<
    | {
        readonly kind: "success";
        readonly finding: ResearchFinding;
        readonly research: ResearchContext;
      }
    | {
        readonly kind: "failure";
        readonly failure: ResearchFailure;
        readonly research: ResearchContext;
      }
  > {
    const agent = this.dependencies.agents.get(target.agentId);
    const role = agent?.role ?? "Research specialist";

    let research: ResearchContext;
    try {
      const result = await this.dependencies.research.conduct({
        query: buildResearchQuery(input.command.message.content, role),
        sourceLimit,
        actorId: target.actorId,
        taskId: researchId,
        sourceIdFactory: (index, candidate) =>
          "research-source-" +
          stableId(
            researchId +
              ":" +
              target.agentId +
              ":" +
              index +
              ":" +
              candidate.locator +
              ":" +
              candidate.retrievedAt,
          ),
        evidenceIdFactory: (index, candidate) =>
          "research-evidence-" +
          stableId(
            researchId +
              ":" +
              target.agentId +
              ":" +
              index +
              ":" +
              candidate.locator +
              ":" +
              candidate.retrievedAt,
          ),
        now: now(),
        signal: input.signal,
      });
      research = { sources: result.sources, evidence: result.evidence };
    } catch (error) {
      const failure: ResearchFailure = {
        agentId: target.agentId,
        actorId: target.actorId,
        stage: "RESEARCH",
        error: error instanceof Error ? error.message : "Research retrieval failed.",
      };
      this.persistFailure(researchId, input, failure, now());
      return { kind: "failure", failure, research: { sources: [], evidence: [] } };
    }

    try {
      const response = await this.dependencies.agentGateway.invokeText({
        agentId: target.agentId,
        runId: researchId,
        requiredCapabilityIds: input.requiredCapabilityIds,
        request: this.buildFindingRequest(
          input.command.message.content,
          role,
          agent?.name ?? target.agentId,
          research,
          buildAgentRolePrompt(agent, "research"),
        ),
        ...(input.signal === undefined ? {} : { modelOptions: { signal: input.signal } }),
      });
      const content = response.output.content.trim().slice(0, MAX_FINDING_CHARACTERS);
      if (content === "") throw new Error("Research analyst returned empty content.");

      const structuredFinding = parseStructuredFinding({
        id: `finding:${researchId}:${target.agentId}`,
        agentId: target.agentId,
        content,
        evidence: research.evidence,
        createdAt: now(),
      });
      const finding: ResearchFinding = {
        agentId: target.agentId,
        actorId: target.actorId,
        role,
        modelId: response.modelId,
        providerId: response.providerId,
        content,
        sourceIds: research.sources.map((source) => source.id),
        evidenceIds: research.evidence.map((evidence) => evidence.id),
        ...(structuredFinding === undefined ? {} : { finding: structuredFinding }),
      };

      this.persistFinding(researchId, input, finding, now());
      return { kind: "success", finding, research };
    } catch (error) {
      const failure: ResearchFailure = {
        agentId: target.agentId,
        actorId: target.actorId,
        stage: "ANALYSIS",
        error: error instanceof Error ? error.message : "Research analysis failed.",
      };
      this.persistFailure(researchId, input, failure, now());
      return { kind: "failure", failure, research };
    }
  }

  private validateInput(input: ExecuteResearchInput): void {
    if (input.command.message.actorId !== input.actorId) {
      throw new Error("Command actor and research actor must match.");
    }

    const maxParticipants = input.maxParticipants ?? DEFAULT_MAX_PARTICIPANTS;
    if (
      !Number.isInteger(maxParticipants) ||
      maxParticipants < MIN_PARTICIPANTS ||
      maxParticipants > DEFAULT_MAX_PARTICIPANTS
    ) {
      throw new RangeError("Research participant limit must be between 2 and 8.");
    }

    if (input.targets.length < MIN_PARTICIPANTS || input.targets.length > maxParticipants) {
      throw new RangeError(`Research execution requires 2-${maxParticipants} agents.`);
    }

    if (new Set(input.targets.map((target) => target.agentId)).size !== input.targets.length) {
      throw new Error("Research targets must not contain duplicate agent IDs.");
    }

    const sourceLimit = input.sourceLimit ?? DEFAULT_SOURCE_LIMIT;
    if (!Number.isInteger(sourceLimit) || sourceLimit <= 0 || sourceLimit > MAX_SOURCE_LIMIT) {
      throw new RangeError("Research sourceLimit must be an integer between 1 and 20.");
    }
  }

  private buildFindingRequest(
    command: string,
    role: string,
    agentName: string,
    research: ResearchContext,
    rolePrompt: string,
  ): TextModelRequest {
    const sourceContext = research.sources
      .map((source) => `[source:${source.id}] ${source.title} — ${source.locator}`)
      .join("\n");
    const evidenceContext = formatEvidenceContext(research);

    return {
      messages: [
        {
          role: "SYSTEM",
          content:
            "You are a research member of POLYON. Investigate only from the evidence provided. " +
            "Separate source-supported facts from interpretation, identify gaps, and do not invent " +
            "verification or external actions.\n" +
            rolePrompt,
        },
        {
          role: "USER",
          content:
            `User request: ${command}\n\nRole: ${role}\nResearcher: ${agentName}\n\n` +
            (sourceContext === "" ? "No sources were retrieved." : `Sources:\n${sourceContext}`) +
            (evidenceContext === "" ? "" : `\n\nEvidence:\n${evidenceContext}`) +
            "\n\nReturn the strongest supported findings, contradictory signals, and uncertainties. " +
            "When possible, also return a JSON object with claim, confidence (0..1), assumptions, " +
            "counterarguments, disposition (SUPPORTED|CONTRADICTED|UNRESOLVED|INFERRED), and evidenceIds.",
        },
      ],
    };
  }

  private buildSynthesisRequest(
    command: string,
    findings: readonly ResearchFinding[],
    failures: readonly ResearchFailure[],
    research: ResearchContext,
    rolePrompt: string,
  ): TextModelRequest {
    const findingBlocks = findings.map(
      (finding) =>
        `[agent=${finding.agentId} role=${finding.role} model=${finding.modelId} provider=${finding.providerId}]\n${finding.content}`,
    );
    const failureBlocks = failures.map(
      (failure) => `[agent=${failure.agentId} stage=${failure.stage}] failed: ${failure.error}`,
    );
    const evidenceContext = formatEvidenceContext(research);

    const context = fitBlocksToBudget(
      [...findingBlocks, ...failureBlocks, evidenceContext],
      MAX_CONTEXT_CHARACTERS,
    );

    return {
      messages: [
        {
          role: "SYSTEM",
          content:
            "You are POLYON's research synthesis lead. Build one evidence-grounded answer from " +
            "multiple research members. Never treat agent agreement as proof. Distinguish facts, " +
            "source-backed claims, interpretation, contradictions, gaps, and uncertainty. Cite " +
            "source IDs when making source-supported claims. Never invent sources.\n" +
            rolePrompt,
        },
        {
          role: "USER",
          content:
            `Research question: ${command}\n\nResearch workspace:\n${context}\n\n` +
            "Return sections: Findings, Evidence, Contradictions, Gaps, Uncertainty, Conclusion.",
        },
      ],
    };
  }

  private persistStart(
    researchId: string,
    input: ExecuteResearchInput,
    synthesizerAgentId: AgentId,
    sourceLimit: number,
    occurredAt: string,
  ): void {
    this.withStores((stores) => {
      this.appendEvent(stores, {
        id: `RESEARCH_STARTED:${researchId}`,
        kind: "RESEARCH_STARTED",
        actorId: input.actorId,
        conversationId: input.command.conversation.id,
        occurredAt,
        data: {
          researchId,
          participantAgentIds: input.targets.map((target) => target.agentId),
          synthesizerAgentId,
          sourceLimit,
          commandMessageId: input.command.message.id,
        },
      });
    });
  }

  private persistFinding(
    researchId: string,
    input: ExecuteResearchInput,
    finding: ResearchFinding,
    occurredAt: string,
  ): void {
    this.withStores((stores) => {
      const messageId = `research:${researchId}:agent:${finding.agentId}`;
      if (stores.messages.get(messageId) === undefined) {
        stores.messages.save({
          id: messageId,
          conversationId: input.command.conversation.id,
          actorId: finding.actorId,
          role: "AGENT",
          kind: "TEXT",
          content: finding.content,
          createdAt: occurredAt,
        });
      }

      const conversation = stores.conversations.get(input.command.conversation.id);
      if (conversation === undefined) {
        throw new Error(`Conversation not found: ${input.command.conversation.id}.`);
      }

      if (!conversation.messageIds.includes(messageId)) {
        stores.conversations.save({
          ...conversation,
          messageIds: [...conversation.messageIds, messageId],
          updatedAt: occurredAt,
        });
      }

      this.appendEvent(stores, {
        id: `RESEARCH_FINDING:${researchId}:${finding.agentId}`,
        kind: "RESEARCH_FINDING",
        actorId: finding.actorId,
        conversationId: input.command.conversation.id,
        occurredAt,
        data: {
          researchId,
          agentId: finding.agentId,
          role: finding.role,
          modelId: finding.modelId,
          providerId: finding.providerId,
          messageId,
          sourceIds: [...finding.sourceIds],
          evidenceIds: [...finding.evidenceIds],
          ...(finding.finding === undefined
            ? {}
            : {
                finding: {
                  id: finding.finding.id,
                  confidence: finding.finding.confidence,
                  disposition: finding.finding.disposition,
                  evidenceIds: finding.finding.evidence.map((item) => item.evidenceId),
                },
              }),
        },
      });
    });
  }

  private persistFailure(
    researchId: string,
    input: ExecuteResearchInput,
    failure: ResearchFailure,
    occurredAt: string,
  ): void {
    this.withStores((stores) => {
      this.appendEvent(stores, {
        id: `RESEARCH_FAILURE:${researchId}:${failure.agentId}:${failure.stage}`,
        kind: "ERROR",
        actorId: failure.actorId,
        conversationId: input.command.conversation.id,
        occurredAt,
        data: {
          researchId,
          subsystem: "RESEARCH_ORCHESTRATION",
          agentId: failure.agentId,
          stage: failure.stage,
          error: failure.error,
        },
      });
    });
  }

  private persistSynthesis(
    researchId: string,
    input: ExecuteResearchInput,
    synthesizerAgentId: AgentId,
    content: string,
    modelId: string,
    providerId: string,
    occurredAt: string,
  ): Message {
    const message: Message = {
      id: `research:${researchId}:synthesis`,
      conversationId: input.command.conversation.id,
      actorId: synthesizerAgentId,
      role: "AGENT",
      kind: "TEXT",
      content,
      createdAt: occurredAt,
    };

    this.withStores((stores) => {
      if (stores.messages.get(message.id) === undefined) {
        stores.messages.save(message);
      }

      const conversation = stores.conversations.get(input.command.conversation.id);
      if (conversation === undefined) {
        throw new Error(`Conversation not found: ${input.command.conversation.id}.`);
      }

      if (!conversation.messageIds.includes(message.id)) {
        stores.conversations.save({
          ...conversation,
          messageIds: [...conversation.messageIds, message.id],
          updatedAt: occurredAt,
        });
      }

      this.appendEvent(stores, {
        id: `RESEARCH_SYNTHESIZED:${message.id}`,
        kind: "RESEARCH_SYNTHESIZED",
        actorId: synthesizerAgentId,
        conversationId: input.command.conversation.id,
        occurredAt,
        data: {
          researchId,
          messageId: message.id,
          modelId,
          providerId,
        },
      });
    });

    return message;
  }

  private persistCompletion(
    researchId: string,
    input: ExecuteResearchInput,
    synthesizerAgentId: AgentId,
    findings: readonly ResearchFinding[],
    failures: readonly ResearchFailure[],
    research: ResearchContext,
    synthesisMessageId: string,
    occurredAt: string,
  ): void {
    this.withStores((stores) => {
      this.appendEvent(stores, {
        id: `RESEARCH_COMPLETED:${researchId}`,
        kind: "RESEARCH_COMPLETED",
        actorId: synthesizerAgentId,
        conversationId: input.command.conversation.id,
        occurredAt,
        data: {
          researchId,
          findingCount: findings.length,
          failureCount: failures.length,
          sourceIds: research.sources.map((source) => source.id),
          evidenceIds: research.evidence.map((evidence) => evidence.id),
          synthesisMessageId,
        },
      });
    });
  }

  private withStores<T>(operation: (stores: ResearchStores) => T): T {
    if (this.dependencies.unitOfWork === undefined) {
      return operation(this.dependencies);
    }

    return this.dependencies.unitOfWork.transaction(operation);
  }

  private appendEvent(stores: ResearchStores, event: DomainEvent): void {
    if (stores.events.get(event.id) === undefined) {
      stores.events.append(event);
    }
  }
}

function buildResearchQuery(command: string, role: string): string {
  return command.trim() + "\n\nResearch focus: " + role;
}

function mergeResearchContext(contexts: readonly ResearchContext[]): ResearchContext {
  const sources = new Map<string, Source>();
  const evidence = new Map<string, Evidence>();

  for (const context of contexts) {
    for (const source of context.sources) sources.set(source.id, source);
    for (const item of context.evidence) evidence.set(item.id, item);
  }

  return { sources: [...sources.values()], evidence: [...evidence.values()] };
}

function formatEvidenceContext(context: ResearchContext): string {
  const lines: string[] = [];
  let total = 0;

  for (const item of context.evidence) {
    const line = `[evidence:${item.id} source:${item.sourceId}]${item.kind}: ${item.claim}\n${item.supportingContent}`;
    if (total + line.length + 2 > MAX_CONTEXT_CHARACTERS) break;
    lines.push(line);
    total += line.length + 2;
  }

  return lines.join("\n\n");
}

function stableId(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
