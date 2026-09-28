import type { AgentId, Task } from "@polyon/contracts";

import type { ConversationAgentOrchestrationService } from "./conversation-agent-orchestration-service";
import type { CommandIngressService } from "./command-ingress";

type A2ATaskState =
  | "TASK_STATE_SUBMITTED"
  | "TASK_STATE_WORKING"
  | "TASK_STATE_COMPLETED"
  | "TASK_STATE_FAILED"
  | "TASK_STATE_CANCELED"
  | "TASK_STATE_INPUT_REQUIRED"
  | "TASK_STATE_REJECTED";

const DEFAULT_TASK_PAGE_SIZE = 50;
const MAX_TASK_PAGE_SIZE = 100;

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
    list(): readonly {
      id: AgentId;
      name: string;
      role: string;
      status: string;
      description?: string;
    }[];
  };
  readonly commandIngress: CommandIngressService;
  readonly conversationOrchestration: ConversationAgentOrchestrationService;
  readonly tasks: {
    list(): readonly Task[];
    get(taskId: string): Task | undefined;
  };
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
        return this.getTask(request);
      case "ListTasks":
      case "tasks/list":
        return this.listTasks(request);
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
      securitySchemes: {
        bearer: {
          type: "http",
          scheme: "bearer",
        },
      },
    };
  }

  private getTask(request: A2AJsonRpcRequest): A2AJsonRpcResponse {
    const params = request.params ?? {};
    const taskId =
      typeof params.id === "string"
        ? params.id.trim()
        : typeof params.taskId === "string"
          ? params.taskId.trim()
          : "";
    if (taskId === "") return error(request.id, -32602, "Task id is required.");

    const task = this.dependencies.tasks.get(taskId);
    if (task === undefined) return error(request.id, -32004, "Task not found.");

    return {
      jsonrpc: "2.0",
      id: request.id,
      result: mapTask(task),
    };
  }

  private listTasks(request: A2AJsonRpcRequest): A2AJsonRpcResponse {
    const params = request.params ?? {};
    const rawPageSize = params.pageSize ?? params.limit;
    const pageSize = rawPageSize === undefined ? DEFAULT_TASK_PAGE_SIZE : Number(rawPageSize);

    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_TASK_PAGE_SIZE) {
      return error(request.id, -32602, "pageSize must be between 1 and 100.");
    }

    const contextId = readOptionalString(params.contextId);
    const status = parseTaskStateFilter(params.status);
    if (status.error !== undefined) {
      return error(request.id, -32602, status.error);
    }

    const pageToken = decodeTaskPageToken(params.pageToken);
    if (pageToken.error !== undefined) {
      return error(request.id, -32602, pageToken.error);
    }

    const filtered = this.dependencies.tasks
      .list()
      .filter((task) => contextId === undefined || task.missionId === contextId)
      .filter((task) => status.state === undefined || mapTaskState(task.status) === status.state)
      .sort(compareTasks);

    const startIndex =
      pageToken.cursor === undefined
        ? 0
        : filtered.findIndex(
              (task) =>
                task.updatedAt === pageToken.cursor!.updatedAt && task.id === pageToken.cursor!.id,
            ) + 1;

    if (pageToken.cursor !== undefined && startIndex === 0) {
      return error(request.id, -32602, "A2A task page token is out of range.");
    }

    const page = filtered.slice(startIndex, startIndex + pageSize);
    const nextPageToken =
      startIndex + page.length < filtered.length && page.length > 0
        ? encodeTaskPageToken(page[page.length - 1]!)
        : "";

    return {
      jsonrpc: "2.0",
      id: request.id,
      result: {
        tasks: page.map(mapTask),
        nextPageToken,
        pageSize,
        totalSize: filtered.length,
      },
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
        : this.dependencies.agents
            .list()
            .find(
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

function mapTask(task: Task): Record<string, unknown> {
  return {
    id: task.id,
    contextId: task.missionId,
    status: {
      state: mapTaskState(task.status),
      timestamp: task.updatedAt,
    },
    metadata: {
      polyonTaskKind: task.kind,
    },
  };
}

function mapTaskState(status: Task["status"]): A2ATaskState {
  switch (status) {
    case "PENDING":
    case "BLOCKED":
    case "READY":
    case "APPROVAL_REQUIRED":
    case "APPROVED":
      return "TASK_STATE_SUBMITTED";
    case "RUNNING":
    case "PAUSED":
      return "TASK_STATE_WORKING";
    case "SUCCEEDED":
      return "TASK_STATE_COMPLETED";
    case "CANCELLED":
      return "TASK_STATE_CANCELED";
    case "FAILED":
      return "TASK_STATE_FAILED";
    case "REJECTED":
      return "TASK_STATE_REJECTED";
  }
}

function parseTaskStateFilter(value: unknown): {
  readonly state?: A2ATaskState;
  readonly error?: string;
} {
  if (value === undefined) return {};

  const normalized = typeof value === "string" ? value.trim() : "";
  switch (normalized) {
    case "TASK_STATE_SUBMITTED":
    case "submitted":
      return { state: "TASK_STATE_SUBMITTED" };
    case "TASK_STATE_WORKING":
    case "working":
      return { state: "TASK_STATE_WORKING" };
    case "TASK_STATE_COMPLETED":
    case "completed":
      return { state: "TASK_STATE_COMPLETED" };
    case "TASK_STATE_FAILED":
    case "failed":
      return { state: "TASK_STATE_FAILED" };
    case "TASK_STATE_CANCELED":
    case "canceled":
      return { state: "TASK_STATE_CANCELED" };
    case "TASK_STATE_INPUT_REQUIRED":
    case "input-required":
      return { state: "TASK_STATE_INPUT_REQUIRED" };
    case "TASK_STATE_REJECTED":
    case "rejected":
      return { state: "TASK_STATE_REJECTED" };
    default:
      return { error: "Unsupported A2A task status filter." };
  }
}

function compareTasks(left: Task, right: Task): number {
  const byUpdatedAt = right.updatedAt.localeCompare(left.updatedAt);
  return byUpdatedAt !== 0 ? byUpdatedAt : right.id.localeCompare(left.id);
}

function encodeTaskPageToken(task: Task): string {
  return (
    "a2a-tasks:" +
    encodeURIComponent(task.updatedAt) +
    ":" +
    encodeURIComponent(task.id)
  );
}

function decodeTaskPageToken(value: unknown): {
  readonly cursor?: { readonly updatedAt: string; readonly id: string };
  readonly error?: string;
} {
  if (value === undefined) return {};

  if (typeof value !== "string" || !value.startsWith("a2a-tasks:")) {
    return { error: "A2A task page token is invalid." };
  }

  const remainder = value.slice("a2a-tasks:".length);
  const separator = remainder.indexOf(":");
  if (separator <= 0) return { error: "A2A task page token is invalid." };

  try {
    const updatedAt = decodeURIComponent(remainder.slice(0, separator));
    const id = decodeURIComponent(remainder.slice(separator + 1));
    if (updatedAt === "" || id === "") {
      return { error: "A2A task page token is invalid." };
    }
    if (Number.isNaN(Date.parse(updatedAt))) {
      return { error: "A2A task page token is invalid." };
    }
    return { cursor: { updatedAt, id } };
  } catch {
    return { error: "A2A task page token is invalid." };
  }
}

function readOptionalString(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return "";
  const normalized = value.trim();
  return normalized === "" ? "" : normalized;
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
