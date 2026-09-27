import type { AgentId } from "@polyon/contracts";

import type { ConversationAgentOrchestrationService } from "./conversation-agent-orchestration-service";
import type { CommandIngressService } from "./command-ingress";

export interface A2AJsonRpcRequest {
  readonly jsonrpc: "2.0";
  readonly id: string | number | null;
  readonly method: string;
  readonly params?: Record<string, unknown>;
}

export interface A2AJsonRpcResponse {
  readonly jsonrpc: "2.0";
  readonly id: string | number | null;
  readonly result?: unknown;
  readonly error?: { readonly code: number; readonly message: string };
}

export interface A2AServerDependencies {
  readonly agents: {
    list(): readonly { id: AgentId; name: string; role: string; status: string; description?: string }[];
  };
  readonly commandIngress: CommandIngressService;
  readonly conversationOrchestration: ConversationAgentOrchestrationService;
  readonly policy: import("@polyon/contracts").Policy;
  readonly actorId: string;
}

export class A2AServerService {
  constructor(private readonly dependencies: A2AServerDependencies) {}

  async handle(request: A2AJsonRpcRequest): Promise<A2AJsonRpcResponse> {
    if (request.jsonrpc !== "2.0") {
      return error(request.id, -32600, "Invalid JSON-RPC request.");
    }

    switch (request.method) {
      case "SendMessage":
      case "message/send":
        return this.sendMessage(request);
      case "GetTask":
      case "tasks/get":
        return error(request.id, -32601, "Task RPC is not exposed for direct conversations.");
      case "ListTasks":
      case "tasks/list":
        return { jsonrpc: "2.0", id: request.id, result: { tasks: [] } };
      default:
        return error(request.id, -32601, "A2A method is not supported.");
    }
  }

  agentCard(baseUrl: string): Record<string, unknown> {
    const agents = this.dependencies.agents.list().filter((agent) => agent.status === "ACTIVE");
    return {
      protocolVersion: "1.0.0",
      name: "POLYON",
      description: "Personal AI Operations Network",
      url: baseUrl,
      version: "0.1.0",
      capabilities: {
        streaming: false,
        pushNotifications: false,
        extendedAgentCard: false,
      },
      defaultInputModes: ["text/plain"],
      defaultOutputModes: ["text/plain"],
      skills: agents.map((agent) => ({
        id: agent.id,
        name: agent.name,
        description: agent.description ?? agent.role,
        tags: [agent.role],
      })),
    };
  }

  private async sendMessage(request: A2AJsonRpcRequest): Promise<A2AJsonRpcResponse> {
    const params = request.params ?? {};
    const message = params.message;
    if (!isRecord(message)) return error(request.id, -32602, "A2A message is required.");

    const text = extractText(message);
    if (text === "") return error(request.id, -32602, "A2A message must contain text.");

    const metadata = isRecord(params.metadata) ? params.metadata : {};
    const requestedAgentId =
      typeof metadata.polyonAgentId === "string" ? metadata.polyonAgentId : undefined;

    const agent =
      requestedAgentId === undefined
        ? this.dependencies.agents.list().find((candidate) => candidate.status === "ACTIVE")
        : this.dependencies.agents.list().find(
            (candidate) => candidate.id === requestedAgentId && candidate.status === "ACTIVE",
          );

    if (agent === undefined) {
      return error(request.id, -32602, "No active A2A agent is available.");
    }

    const command = this.dependencies.commandIngress.submit({
      mode: "Direct",
      command: text,
      actorId: this.dependencies.actorId,
      conversationId: "a2a-" + String(request.id),
      messageId: "a2a-message-" + String(request.id),
      eventId: "a2a-event-" + String(request.id),
      participantIds: [this.dependencies.actorId, agent.id],
      createdAt: new Date().toISOString(),
    });

    const result = await this.dependencies.conversationOrchestration.execute({
      command,
      targets: [{ agentId: agent.id, actorId: agent.id }],
      requiredCapabilityIds: [],
      policy: this.dependencies.policy,
      actorId: this.dependencies.actorId,
    });

    if (result.status !== "SUCCEEDED") {
      return error(
        request.id,
        result.status === "APPROVAL_REQUIRED" ? -32003 : -32000,
        result.status === "APPROVAL_REQUIRED"
          ? "A2A operation requires human approval."
          : "A2A agent execution failed.",
      );
    }

    return {
      jsonrpc: "2.0",
      id: request.id,
      result: {
        role: "agent",
        parts: [{ kind: "text", text: result.persistedMessages[0]?.content ?? "" }],
      },
    };
  }
}

function extractText(message: Record<string, unknown>): string {
  const parts = message.parts;
  if (!Array.isArray(parts)) return "";
  return parts
    .map((part) => (isRecord(part) && typeof part.text === "string" ? part.text : ""))
    .join("\n")
    .trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function error(id: string | number | null, code: number, message: string): A2AJsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}
