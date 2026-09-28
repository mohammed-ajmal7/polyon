import type {
  AgentId,
  DomainEvent,
  Message,
  TextModelRequest,
} from "@polyon/contracts";
import type { AgentGateway, AgentRegistry } from "@polyon/agents";
import type {
  ConversationStore,
  DomainUnitOfWork,
  EventStore,
  MessageStore,
} from "@polyon/storage";
import type { CommandIngressResult } from "./command-ingress";

const DEFAULT_MAX_PARTICIPANTS = 8;
const MIN_PARTICIPANTS = 2;
const MAX_CONTRIBUTION_CHARACTERS = 12_000;
const MAX_SYNTHESIS_CONTEXT_CHARACTERS = 60_000;

export interface CollectiveTarget {
  readonly agentId: AgentId;
  readonly actorId: string;
}

export interface ExecuteCollectiveInput {
  readonly command: CommandIngressResult;
  readonly targets: readonly CollectiveTarget[];
  readonly actorId: string;
  readonly requiredCapabilityIds: readonly string[];
  readonly synthesizerAgentId?: AgentId;
  readonly maxParticipants?: number;
  readonly now?: () => string;
}

export interface CollectiveContribution {
  readonly agentId: AgentId;
  readonly actorId: string;
  readonly role: string;
  readonly content: string;
}

export interface CollectiveFailure {
  readonly agentId: AgentId;
  readonly actorId: string;
  readonly error: string;
}

export type CollectiveExecutionStatus = "SUCCEEDED" | "PARTIAL" | "FAILED";

export interface CollectiveExecutionResult {
  readonly collectiveId: string;
  readonly status: CollectiveExecutionStatus;
  readonly synthesizerAgentId: AgentId;
  readonly contributions: readonly CollectiveContribution[];
  readonly failures: readonly CollectiveFailure[];
  readonly synthesis?: Message;
}

export interface CollectiveOrchestrationDependencies {
  readonly agents: AgentRegistry;
  readonly agentGateway: AgentGateway;
  readonly conversations: ConversationStore;
  readonly messages: MessageStore;
  readonly events: EventStore;
  readonly unitOfWork?: DomainUnitOfWork;
}

export class CollectiveOrchestrationService {
  constructor(private readonly dependencies: CollectiveOrchestrationDependencies) {}

  async execute(input: ExecuteCollectiveInput): Promise<CollectiveExecutionResult> {
    this.validateInput(input);

    const now = input.now ?? (() => new Date().toISOString());
    const targets = [...input.targets];
    const synthesizerAgentId =
      input.synthesizerAgentId ?? targets[targets.length - 1]!.agentId;
    const collectiveId = `collective:${input.command.conversation.id}:${input.command.message.id}`;

    const synthesizer = this.dependencies.agents.get(synthesizerAgentId);
    if (synthesizer === undefined || synthesizer.status !== "ACTIVE") {
      throw new Error(`Synthesizer agent is not active: ${synthesizerAgentId}.`);
    }

    const contributors = targets.filter((target) => target.agentId !== synthesizerAgentId);
    const contributorResults = await Promise.all(
      contributors.map(async (target) => {
        const agent = this.dependencies.agents.get(target.agentId);
        const role = agent?.role ?? "Generalist";

        try {
          const response = await this.dependencies.agentGateway.invokeText({
            agentId: target.agentId,
            requiredCapabilityIds: input.requiredCapabilityIds,
            request: this.buildContributorRequest(
              input.command.message.content,
              role,
              agent?.name ?? target.agentId,
            ),
          });

          return {
            kind: "success" as const,
            contribution: {
              agentId: target.agentId,
              actorId: target.actorId,
              role,
              content: response.output.content.trim().slice(0, MAX_CONTRIBUTION_CHARACTERS),
            },
          };
        } catch (error) {
          return {
            kind: "failure" as const,
            failure: {
              agentId: target.agentId,
              actorId: target.actorId,
              error: error instanceof Error ? error.message : "Agent invocation failed.",
            },
          };
        }
      }),
    );

    const contributions = contributorResults
      .filter(
        (result): result is Extract<(typeof contributorResults)[number], { kind: "success" }> =>
          result.kind === "success",
      )
      .map((result) => result.contribution)
      .filter((item) => item.content !== "");

    const failures = contributorResults
      .filter(
        (result): result is Extract<(typeof contributorResults)[number], { kind: "failure" }> =>
          result.kind === "failure",
      )
      .map((result) => result.failure);

    this.persistStart(collectiveId, input, synthesizerAgentId, now());
    this.persistContributions(collectiveId, input, contributions, failures, now());

    if (contributions.length === 0) {
      this.persistFailure(
        collectiveId,
        input,
        synthesizerAgentId,
        "No contributor returned a usable result.",
        now(),
      );
      return {
        collectiveId,
        status: "FAILED",
        synthesizerAgentId,
        contributions,
        failures,
      };
    }

    let synthesisContent: string;
    try {
      const response = await this.dependencies.agentGateway.invokeText({
        agentId: synthesizerAgentId,
        requiredCapabilityIds: input.requiredCapabilityIds,
        request: this.buildSynthesisRequest(input.command.message.content, contributions, failures),
      });
      synthesisContent = response.output.content.trim().slice(0, MAX_CONTRIBUTION_CHARACTERS);
    } catch (error) {
      this.persistFailure(
        collectiveId,
        input,
        synthesizerAgentId,
        error instanceof Error ? error.message : "Synthesis failed.",
        now(),
      );
      return {
        collectiveId,
        status: "FAILED",
        synthesizerAgentId,
        contributions,
        failures,
      };
    }

    if (synthesisContent === "") {
      this.persistFailure(
        collectiveId,
        input,
        synthesizerAgentId,
        "Synthesis agent returned empty content.",
        now(),
      );
      return {
        collectiveId,
        status: "FAILED",
        synthesizerAgentId,
        contributions,
        failures,
      };
    }

    const synthesis = this.persistSynthesis(
      collectiveId,
      input,
      synthesizerAgentId,
      synthesisContent,
      now(),
    );

    return {
      collectiveId,
      status: failures.length === 0 ? "SUCCEEDED" : "PARTIAL",
      synthesizerAgentId,
      contributions,
      failures,
      synthesis,
    };
  }

  private validateInput(input: ExecuteCollectiveInput): void {
    if (input.command.message.actorId !== input.actorId) {
      throw new Error("Command actor and collective actor must match.");
    }

    const maxParticipants = input.maxParticipants ?? DEFAULT_MAX_PARTICIPANTS;
    if (
      !Number.isInteger(maxParticipants) ||
      maxParticipants < MIN_PARTICIPANTS ||
      maxParticipants > DEFAULT_MAX_PARTICIPANTS
    ) {
      throw new RangeError("Collective participant limit must be between 2 and 8.");
    }

    if (input.targets.length < MIN_PARTICIPANTS || input.targets.length > maxParticipants) {
      throw new RangeError(`Collective execution requires 2-${maxParticipants} agents.`);
    }

    if (new Set(input.targets.map((target) => target.agentId)).size !== input.targets.length) {
      throw new Error("Collective targets must not contain duplicate agent IDs.");
    }
  }

  private buildContributorRequest(
    command: string,
    role: string,
    agentName: string,
  ): TextModelRequest {
    return {
      messages: [
        {
          role: "SYSTEM",
          content:
            "You are a specialist member of POLYON's AI collective. " +
            "Work independently, contribute a distinct perspective, and " +
            "separate facts from interpretation. " +
            "Do not claim to have verified information you did not receive. " +
            "Do not take external actions.",
        },
        {
          role: "USER",
          content:
            `User request: ${command}\n\nYour role: ${role}\nAgent: ${agentName}\n\n` +
            "Analyze the request from your specialist perspective. " +
            "Return the useful findings, important assumptions, and " +
            "uncertainties for another agent to synthesize.",
        },
      ],
    };
  }

  private buildSynthesisRequest(
    command: string,
    contributions: readonly CollectiveContribution[],
    failures: readonly CollectiveFailure[],
  ): TextModelRequest {
    const lines = contributions.map(
      (item) =>
        `[agent=${item.agentId} role=${item.role}]\n${item.content}`,
    );
    const failureLines = failures.map(
      (item) => `[agent=${item.agentId}] failed: ${item.error}`,
    );

    let context = "";
    for (const line of [...lines, ...failureLines]) {
      if (context.length + line.length + 2 > MAX_SYNTHESIS_CONTEXT_CHARACTERS) break;
      context += (context === "" ? "" : "\n\n") + line;
    }

    return {
      messages: [
        {
          role: "SYSTEM",
          content:
            "You are POLYON's synthesis lead. Produce one transparent answer from " +
            "the collective. Do not treat agent agreement as proof. Distinguish " +
            "directly supported facts, agent interpretations, disagreements, " +
            "missing information, and uncertainty. " +
            "Do not invent sources or verification. " +
            "Prefer a useful conclusion with explicit caveats.",
        },
        {
          role: "USER",
          content:
            `User request: ${command}\n\nCollective findings:\n${context}\n\n` +
            "Format the response with these sections: Findings, Agreements, Disagreements, " +
            "Uncertainty, Conclusion.",
        },
      ],
    };
  }

  private persistStart(
    collectiveId: string,
    input: ExecuteCollectiveInput,
    synthesizerAgentId: AgentId,
    occurredAt: string,
  ): void {
    this.withStores((stores) => {
      stores.events.append({
        id: `COLLECTIVE_STARTED:${collectiveId}`,
        kind: "COLLECTIVE_STARTED",
        actorId: input.actorId,
        conversationId: input.command.conversation.id,
        occurredAt,
        data: {
          collectiveId,
          participantAgentIds: input.targets.map((target) => target.agentId),
          synthesizerAgentId,
          commandMessageId: input.command.message.id,
        },
      });
    });
  }

  private persistContributions(
    collectiveId: string,
    input: ExecuteCollectiveInput,
    contributions: readonly CollectiveContribution[],
    failures: readonly CollectiveFailure[],
    occurredAt: string,
  ): void {
    this.withStores((stores) => {
      for (const contribution of contributions) {
        const messageId = `collective:${collectiveId}:agent:${contribution.agentId}`;
        if (stores.messages.get(messageId) === undefined) {
          stores.messages.save({
            id: messageId,
            conversationId: input.command.conversation.id,
            actorId: contribution.actorId,
            role: "AGENT",
            kind: "TEXT",
            content: contribution.content,
            createdAt: occurredAt,
          });
        }

        stores.events.append({
          id: `COLLECTIVE_CONTRIBUTION:${collectiveId}:${contribution.agentId}`,
          kind: "COLLECTIVE_CONTRIBUTION",
          actorId: contribution.actorId,
          conversationId: input.command.conversation.id,
          occurredAt,
          data: {
            collectiveId,
            agentId: contribution.agentId,
            role: contribution.role,
            status: "SUCCEEDED",
            messageId,
          },
        });
      }

      for (const failure of failures) {
        stores.events.append({
          id: `COLLECTIVE_CONTRIBUTION:${collectiveId}:${failure.agentId}`,
          kind: "COLLECTIVE_CONTRIBUTION",
          actorId: failure.actorId,
          conversationId: input.command.conversation.id,
          occurredAt,
          data: {
            collectiveId,
            agentId: failure.agentId,
            status: "FAILED",
            error: failure.error,
          },
        });
      }

      const conversation = stores.conversations.get(input.command.conversation.id);
      if (conversation === undefined) {
        throw new Error(`Conversation not found: ${input.command.conversation.id}.`);
      }

      const contributionMessageIds = contributions.map(
        (contribution) => `collective:${collectiveId}:agent:${contribution.agentId}`,
      );
      stores.conversations.save({
        ...conversation,
        messageIds: [
          ...conversation.messageIds,
          ...contributionMessageIds.filter((id) => !conversation.messageIds.includes(id)),
        ],
        updatedAt: occurredAt,
      });
    });
  }

  private persistSynthesis(
    collectiveId: string,
    input: ExecuteCollectiveInput,
    synthesizerAgentId: AgentId,
    content: string,
    occurredAt: string,
  ): Message {
    const message: Message = {
      id: `collective:${collectiveId}:synthesis`,
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

      const event: DomainEvent = {
        id: `COLLECTIVE_SYNTHESIZED:${collectiveId}`,
        kind: "COLLECTIVE_SYNTHESIZED",
        actorId: synthesizerAgentId,
        conversationId: message.conversationId,
        occurredAt,
        data: {
          collectiveId,
          synthesizerAgentId,
          synthesisMessageId: message.id,
        },
      };
      stores.events.append(event);
    });

    return message;
  }

  private persistFailure(
    collectiveId: string,
    input: ExecuteCollectiveInput,
    synthesizerAgentId: AgentId,
    error: string,
    occurredAt: string,
  ): void {
    this.withStores((stores) => {
      stores.events.append({
        id: `ERROR:COLLECTIVE:${collectiveId}:${occurredAt}:${synthesizerAgentId}`,
        kind: "ERROR",
        actorId: synthesizerAgentId,
        conversationId: input.command.conversation.id,
        occurredAt,
        data: {
          collectiveId,
          subsystem: "COLLECTIVE_ORCHESTRATION",
          error,
        },
      });
    });
  }

  private withStores<T>(work: (stores: {
    readonly conversations: ConversationStore;
    readonly messages: MessageStore;
    readonly events: EventStore;
  }) => T): T {
    if (this.dependencies.unitOfWork === undefined) {
      return work(this.dependencies);
    }

    return this.dependencies.unitOfWork.transaction(work);
  }
}
