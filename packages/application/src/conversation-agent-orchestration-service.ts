import type { ActorId, DomainEvent, Message, TextModelRequest } from "@polyon/contracts";

import type {
  AgentToolOrchestrationResult,
  AgentToolOrchestrationService,
} from "./agent-tool-orchestration-service";
import type { CommandIngressResult } from "./command-ingress";
import type {
  ConversationStore,
  DomainUnitOfWork,
  EventStore,
  MessageStore,
} from "@polyon/storage";

export interface ConversationAgentTarget {
  readonly agentId: string;
  readonly actorId: ActorId;
}

export interface ExecuteConversationInput {
  readonly command: CommandIngressResult;
  readonly targets: readonly ConversationAgentTarget[];
  readonly request?: Omit<TextModelRequest, "messages">;
  readonly requiredCapabilityIds: readonly string[];
  readonly policy: import("@polyon/contracts").Policy;
  readonly actorId: ActorId;
  readonly missionId?: string;
  readonly taskId?: string;
  readonly executionId?: string;
  readonly maxToolRounds?: number;
  readonly maxToolOutputBytes?: number;
}

export type ConversationExecutionStatus = "SUCCEEDED" | "APPROVAL_REQUIRED" | "FAILED";

export interface ConversationExecutionResult {
  readonly status: ConversationExecutionStatus;
  readonly responses: readonly {
    readonly agentId: string;
    readonly result: AgentToolOrchestrationResult;
  }[];
  readonly persistedMessages: readonly Message[];
}

export class ConversationAgentOrchestrationService {
  constructor(
    private readonly orchestration: AgentToolOrchestrationService,
    private readonly conversations: ConversationStore,
    private readonly messages: MessageStore,
    private readonly events: EventStore,
    private readonly unitOfWork?: DomainUnitOfWork,
  ) {}

  async execute(input: ExecuteConversationInput): Promise<ConversationExecutionResult> {
    if (input.command.message.actorId !== input.actorId) {
      throw new Error("Command actor and execution actor must match.");
    }
    if (input.targets.length === 0 || input.targets.length > 20) {
      throw new RangeError("Conversation execution requires 1-20 agent targets.");
    }

    const requestBase: TextModelRequest = {
      messages: [{ role: "USER", content: input.command.message.content }],
      ...(input.request ?? {}),
    };

    const responses: ConversationExecutionResult["responses"][number][] = [];
    const persistedMessages: Message[] = [];

    for (const target of input.targets) {
      const result = await this.orchestration.invoke({
        agentId: target.agentId,
        requiredCapabilityIds: input.requiredCapabilityIds,
        conversationId: input.command.conversation.id,
        request: requestBase,
        policy: input.policy,
        actorId: input.actorId,
        ...(input.missionId === undefined ? {} : { missionId: input.missionId }),
        ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
        ...(input.executionId === undefined ? {} : { executionId: input.executionId }),
        maxToolRounds: input.maxToolRounds,
        maxToolOutputBytes: input.maxToolOutputBytes,
      });

      responses.push({ agentId: target.agentId, result });

      if (result.status === "SUCCEEDED") {
        const message: Message = {
          id: `agent-response:${input.command.message.id}:${target.agentId}`,
          conversationId: input.command.conversation.id,
          actorId: target.actorId,
          role: "AGENT",
          kind: "TEXT",
          content: result.response.content,
          createdAt: new Date().toISOString(),
        };

        const operation = () => {
          if (this.messages.get(message.id) !== undefined) return;
          const conversation = this.conversations.get(input.command.conversation.id);
          if (conversation === undefined) {
            throw new Error(`Conversation not found: ${input.command.conversation.id}.`);
          }

          this.messages.save(message);
          this.conversations.save({
            ...conversation,
            messageIds: [...conversation.messageIds, message.id],
            updatedAt: message.createdAt,
          });
          const event: DomainEvent = {
            id: `MESSAGE_CREATED:${message.id}`,
            kind: "MESSAGE_CREATED",
            actorId: target.actorId,
            conversationId: message.conversationId,
            ...(input.missionId === undefined ? {} : { missionId: input.missionId }),
            ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
            ...(input.executionId === undefined ? {} : { executionId: input.executionId }),
            occurredAt: message.createdAt,
            data: {
              messageId: message.id,
              conversationId: message.conversationId,
              agentId: target.agentId,
              kind: message.kind,
            },
          };
          this.events.append(event);
          persistedMessages.push(message);
        };

        if (this.unitOfWork === undefined) operation();
        else this.unitOfWork.transaction(operation);
      }
    }

    const hasApproval = responses.some((item) => item.result.status === "APPROVAL_REQUIRED");
    const hasSuccess = responses.some((item) => item.result.status === "SUCCEEDED");

    return {
      status: hasApproval ? "APPROVAL_REQUIRED" : hasSuccess ? "SUCCEEDED" : "FAILED",
      responses,
      persistedMessages,
    };
  }

  async resolveToolApproval(input: {
    readonly approvalId: string;
    readonly status: "APPROVED";
    readonly resolvedAt: string;
    readonly resolvedBy?: ActorId;
    readonly policy: import("@polyon/contracts").Policy;
  }): Promise<{
    readonly status: "SUCCEEDED" | "APPROVAL_REQUIRED" | "REJECTED" | "FAILED";
    readonly response: import("@polyon/contracts").TextModelResponse;
    readonly rounds: number;
    readonly conversationId: string;
    readonly agentId: string;
    readonly approval?: Extract<
      import("./agent-tool-orchestration-service").AgentToolOrchestrationResult,
      { status: "APPROVAL_REQUIRED" }
    >["approval"];
    readonly error?: string;
  }> {
    const result = await this.orchestration.resolveConversationToolApproval(
      {
        approvalId: input.approvalId,
        status: input.status,
        resolvedAt: input.resolvedAt,
        ...(input.resolvedBy === undefined ? {} : { resolvedBy: input.resolvedBy }),
      },
      input.policy,
    );

    if (result.status === "SUCCEEDED") {
      const message: Message = {
        id: `agent-response:${input.approvalId}:${result.agentId}`,
        conversationId: result.conversationId,
        actorId: result.agentId,
        role: "AGENT",
        kind: "TEXT",
        content: result.response.content,
        createdAt: result.response.content === "" ? input.resolvedAt : new Date().toISOString(),
      };

      const operation = () => {
        if (this.messages.get(message.id) !== undefined) return;
        const conversation = this.conversations.get(result.conversationId);
        if (conversation === undefined) {
          throw new Error(`Conversation not found: ${result.conversationId}.`);
        }

        this.messages.save(message);
        this.conversations.save({
          ...conversation,
          messageIds: [...conversation.messageIds, message.id],
          updatedAt: message.createdAt,
        });
        this.events.append({
          id: `MESSAGE_CREATED:${message.id}`,
          kind: "MESSAGE_CREATED",
          actorId: result.agentId,
          conversationId: message.conversationId,
          occurredAt: message.createdAt,
          data: {
            messageId: message.id,
            conversationId: message.conversationId,
            agentId: result.agentId,
            kind: message.kind,
          },
        });
      };

      if (this.unitOfWork === undefined) operation();
      else this.unitOfWork.transaction(operation);
    }

    return result;
  }

}
