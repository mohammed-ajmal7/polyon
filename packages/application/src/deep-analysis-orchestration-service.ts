import type { AgentId, DomainEvent, Message } from "@polyon/contracts";
import type { AgentRegistry } from "@polyon/agents";
import type {
  ConversationStore,
  DomainUnitOfWork,
  EventStore,
  MessageStore,
} from "@polyon/storage";

import type {
  CollectiveExecutionResult,
  CollectiveOrchestrationService,
} from "./collective-orchestration-service";
import type { DebateOrchestrationService, DebateRunResult } from "./debate-orchestration-service";
import type { CommandIngressResult } from "./command-ingress";

export type DeepAnalysisExecutionStatus = "SUCCEEDED" | "PARTIAL" | "FAILED";

export interface ExecuteDeepAnalysisInput {
  readonly command: CommandIngressResult;
  readonly targets: readonly {
    readonly agentId: AgentId;
    readonly actorId: string;
  }[];
  readonly actorId: string;
  readonly requiredCapabilityIds: readonly string[];
  readonly synthesizerAgentId?: AgentId;
  readonly maxParticipants?: number;
  readonly maxChallengeRounds?: number;
  readonly maxDebateRounds?: number;
  readonly researchEnabled?: boolean;
  readonly researchSourceLimit?: number;
  readonly now?: () => string;
}

export interface DeepAnalysisExecutionResult {
  readonly status: DeepAnalysisExecutionStatus;
  readonly conversationId: string;
  readonly collective: CollectiveExecutionResult;
  readonly debate?: DebateRunResult;
  readonly decision?: Message;
}

export interface DeepAnalysisOrchestrationDependencies {
  readonly collective: CollectiveOrchestrationService;
  readonly debates: DebateOrchestrationService;
  readonly agents: AgentRegistry;
  readonly conversations: ConversationStore;
  readonly messages: MessageStore;
  readonly events: EventStore;
  readonly unitOfWork?: DomainUnitOfWork;
}

const DEFAULT_MAX_DEBATE_ROUNDS = 2;
const MAX_DEBATE_ROUNDS = 4;
const MAX_CONTEXT_CHARACTERS = 50_000;

export class DeepAnalysisOrchestrationService {
  constructor(private readonly dependencies: DeepAnalysisOrchestrationDependencies) {}

  async execute(input: ExecuteDeepAnalysisInput): Promise<DeepAnalysisExecutionResult> {
    if (input.command.message.actorId !== input.actorId) {
      throw new Error("Command actor and deep-analysis actor must match.");
    }

    const now = input.now ?? (() => new Date().toISOString());
    const synthesizerAgentId =
      input.synthesizerAgentId ?? input.targets[input.targets.length - 1]?.agentId;

    if (synthesizerAgentId === undefined) {
      throw new Error("Deep analysis requires at least one synthesizer agent.");
    }

    const synthesizer = this.dependencies.agents.get(synthesizerAgentId);
    if (synthesizer === undefined || synthesizer.status !== "ACTIVE") {
      throw new Error("Deep analysis synthesizer is not active: " + synthesizerAgentId + ".");
    }

    const deepAnalysisId =
      "deep-analysis:" + input.command.conversation.id + ":" + input.command.message.id;

    this.persistEvent({
      id: "DEEP_ANALYSIS_STARTED:" + deepAnalysisId,
      kind: "DEEP_ANALYSIS_STARTED",
      actorId: input.actorId,
      conversationId: input.command.conversation.id,
      occurredAt: now(),
      data: {
        deepAnalysisId,
        participantAgentIds: input.targets.map((target) => target.agentId),
        synthesizerAgentId,
      },
    });

    const collective = await this.dependencies.collective.execute({
      command: input.command,
      targets: input.targets,
      actorId: input.actorId,
      requiredCapabilityIds: input.requiredCapabilityIds,
      synthesizerAgentId,
      maxParticipants: input.maxParticipants,
      maxChallengeRounds: input.maxChallengeRounds ?? 0,
      researchEnabled: input.researchEnabled,
      researchSourceLimit: input.researchSourceLimit,
      now,
    });

    if (collective.status === "FAILED" || collective.synthesis === undefined) {
      this.persistError(
        input,
        deepAnalysisId,
        now(),
        "Collective analysis did not produce a synthesis.",
      );
      return {
        status: "FAILED",
        conversationId: input.command.conversation.id,
        collective,
      };
    }

    const debateId = deepAnalysisId + ":debate";
    const context = buildDebateContext(collective);

    const maxDebateRounds = input.maxDebateRounds ?? DEFAULT_MAX_DEBATE_ROUNDS;
    if (
      !Number.isInteger(maxDebateRounds) ||
      maxDebateRounds <= 0 ||
      maxDebateRounds > MAX_DEBATE_ROUNDS
    ) {
      throw new RangeError(
        "Deep analysis maxDebateRounds must be an integer between 1 and 4.",
      );
    }

    this.dependencies.debates.create({
      id: debateId,
      objective: input.command.message.content,
      participantAgentIds: input.targets.map((target) => target.agentId),
      maxParticipants: input.maxParticipants ?? Math.min(input.targets.length, 8),
      maxRounds: maxDebateRounds,
      createdAt: now(),
    });

    const debate = await this.dependencies.debates
      .run({
        debateId,
        requiredCapabilityIds: input.requiredCapabilityIds,
        adjudicatorAgentId: synthesizerAgentId,
        now,
        context,
      })
      .catch((error) => {
      this.persistError(
        input,
        deepAnalysisId,
        now(),
        error instanceof Error ? error.message : "Deep-analysis debate failed.",
      );
      return undefined;
    });

    if (debate === undefined) {
      return {
        status: "PARTIAL",
        conversationId: input.command.conversation.id,
        collective,
      };
    }

    const decision = this.persistDebateTranscript(
      input,
      deepAnalysisId,
      synthesizerAgentId,
      debate,
      now,
    );

    this.persistEvent({
      id: "DEEP_ANALYSIS_COMPLETED:" + deepAnalysisId,
      kind: "DEEP_ANALYSIS_COMPLETED",
      actorId: synthesizerAgentId,
      conversationId: input.command.conversation.id,
      occurredAt: now(),
      data: {
        deepAnalysisId,
        debateId,
        collectiveId: collective.collectiveId,
        decisionMessageId: decision.id,
        debateStatus: debate.debate.status,
      },
    });

    return {
      status: collective.status === "SUCCEEDED" ? "SUCCEEDED" : "PARTIAL",
      conversationId: input.command.conversation.id,
      collective,
      debate,
      decision,
    };
  }

  private persistDebateTranscript(
    input: ExecuteDeepAnalysisInput,
    deepAnalysisId: string,
    adjudicatorAgentId: AgentId,
    debate: DebateRunResult,
    now: () => string,
  ): Message {
    const decisionMessageId = "deep-analysis:" + deepAnalysisId + ":decision";
    const operation = (stores: {
      readonly conversations: ConversationStore;
      readonly messages: MessageStore;
      readonly events: EventStore;
    }) => {
      const conversation = stores.conversations.get(input.command.conversation.id);
      if (conversation === undefined) {
        throw new Error("Conversation not found: " + input.command.conversation.id + ".");
      }

      const messageIds = [...conversation.messageIds];
      for (const contribution of debate.contributions) {
        const messageId =
          "deep-analysis:" +
          deepAnalysisId +
          ":round:" +
          contribution.round +
          ":" +
          contribution.phase +
          ":" +
          contribution.agentId;
        if (stores.messages.get(messageId) === undefined) {
          const message: Message = {
            id: messageId,
            conversationId: conversation.id,
            actorId: contribution.agentId,
            role: "AGENT",
            kind: "TEXT",
            content: contribution.content,
            createdAt: now(),
          };
          stores.messages.save(message);
        }
        if (!messageIds.includes(messageId)) messageIds.push(messageId);
      }

      const decision: Message = {
        id: decisionMessageId,
        conversationId: conversation.id,
        actorId: adjudicatorAgentId,
        role: "AGENT",
        kind: "TEXT",
        content: debate.decision,
        createdAt: now(),
      };

      if (stores.messages.get(decision.id) === undefined) {
        stores.messages.save(decision);
      }
      if (!messageIds.includes(decision.id)) messageIds.push(decision.id);

      stores.conversations.save({
        ...conversation,
        messageIds,
        updatedAt: decision.createdAt,
      });

      return decision;
    };

    if (this.dependencies.unitOfWork === undefined) {
      return operation(this.dependencies);
    }
    return this.dependencies.unitOfWork.transaction(operation);
  }

  private persistEvent(event: DomainEvent): void {
    const operation = (stores: { readonly events: EventStore }) => {
      if (stores.events.get(event.id) === undefined) stores.events.append(event);
    };
    if (this.dependencies.unitOfWork === undefined) {
      operation(this.dependencies);
    } else {
      this.dependencies.unitOfWork.transaction(operation);
    }
  }

  private persistError(
    input: ExecuteDeepAnalysisInput,
    deepAnalysisId: string,
    occurredAt: string,
    error: string,
  ): void {
    this.persistEvent({
      id: "ERROR:DEEP_ANALYSIS:" + deepAnalysisId,
      kind: "ERROR",
      actorId: input.actorId,
      conversationId: input.command.conversation.id,
      occurredAt,
      data: {
        deepAnalysisId,
        subsystem: "DEEP_ANALYSIS_ORCHESTRATION",
        error,
      },
    });
  }
}

function buildDebateContext(collective: CollectiveExecutionResult): string {
  const contributionLines = collective.contributions.map(
    (item) =>
      "[agent=" +
      item.agentId +
      " role=" +
      item.role +
      "]\n" +
      item.content,
  );
  const blocks = [
    "Collective synthesis:\n" + (collective.synthesis?.content ?? ""),
    "Independent findings:\n" + contributionLines.join("\n\n"),
  ];

  let context = "";
  for (const block of blocks) {
    if (context.length + block.length + 2 > MAX_CONTEXT_CHARACTERS) break;
    context += (context === "" ? "" : "\n\n") + block;
  }

  return context;
}
