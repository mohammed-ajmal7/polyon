import type { AgentId, Execution, Task } from "@polyon/contracts";

import type { A2APushNotificationService } from "./a2a-push-notification-service";

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

const A2A_PROTOCOL_VERSION = "1.0";
const DEFAULT_TASK_PAGE_SIZE = 50;
const MAX_TASK_PAGE_SIZE = 100;
const DEFAULT_STREAM_POLL_INTERVAL_MS = 250;
const DEFAULT_STREAM_MAX_DURATION_MS = 300_000;

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

export type A2AStreamWait = (milliseconds: number) => Promise<void>;

export interface A2AServerOptions {
  readonly streamPollIntervalMs?: number;
  readonly streamMaxDurationMs?: number;
  readonly wait?: A2AStreamWait;
  readonly now?: () => number;
}

export interface A2ARequestHeaders {
  readonly version?: string;
}

export interface A2AExecutionRuntime {
  cancel(
    executionId: string,
  ):
    | { readonly status: "CANCELLED"; readonly execution: Execution }
    | { readonly status: "NOT_FOUND"; readonly executionId: string }
    | { readonly status: "NOT_CANCELLABLE"; readonly execution: Execution };
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
  readonly executions: {
    list(): readonly Execution[];
  };
  readonly runtime: A2AExecutionRuntime;
  readonly tasks: {
    list(): readonly Task[];
    get(taskId: string): Task | undefined;
  };
  readonly policy: import("@polyon/contracts").Policy;
  readonly actorId: string;
  readonly pushNotifications?: A2APushNotificationService;
}

export class A2AServerService {
  private readonly streamPollIntervalMs: number;
  private readonly streamMaxDurationMs: number;
  private readonly wait: A2AStreamWait;
  private readonly now: () => number;

  constructor(
    private readonly dependencies: A2AServerDependencies,
    options: A2AServerOptions = {},
  ) {
    this.streamPollIntervalMs =
      options.streamPollIntervalMs ?? DEFAULT_STREAM_POLL_INTERVAL_MS;
    this.streamMaxDurationMs =
      options.streamMaxDurationMs ?? DEFAULT_STREAM_MAX_DURATION_MS;
    this.wait = options.wait ?? defaultWait;
    this.now = options.now ?? Date.now;

    validateNonNegativeNumber(this.streamPollIntervalMs, "A2A stream poll interval");
    validatePositiveNumber(this.streamMaxDurationMs, "A2A stream maximum duration");
  }

  async handle(
    request: A2AJsonRpcRequest,
    headers: A2ARequestHeaders = {},
  ): Promise<A2AJsonRpcResponse> {
    const versionError = validateVersion(headers.version);
    if (versionError !== undefined) return error(request.id, -32009, versionError);

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
      case "CancelTask":
      case "tasks/cancel":
        return this.cancelTask(request);
      case "ListTasks":
      case "tasks/list":
        return this.listTasks(request);
      case "CreateTaskPushNotificationConfig":
        return this.createPushNotificationConfig(request);
      case "GetTaskPushNotificationConfig":
        return this.getPushNotificationConfig(request);
      case "ListTaskPushNotificationConfigs":
        return this.listPushNotificationConfigs(request);
      case "DeleteTaskPushNotificationConfig":
        return this.deletePushNotificationConfig(request);
      case "GetExtendedAgentCard":
        return {
          jsonrpc: "2.0",
          id: request.id,
          result: this.extendedAgentCard(""),
        };
      case "SendStreamingMessage":
      case "message/stream":
      case "SubscribeToTask":
      case "tasks/subscribe":
      case "tasks/resubscribe":
        return error(
          request.id,
          -32004,
          "A2A streaming operations require an SSE response.",
        );
      default:
        return error(request.id, -32601, "A2A method is not supported.");
    }
  }

  async *stream(
    request: A2AJsonRpcRequest,
    headers: A2ARequestHeaders = {},
    signal?: AbortSignal,
  ): AsyncIterable<A2AJsonRpcResponse> {
    const versionError = validateVersion(headers.version);
    if (versionError !== undefined) {
      yield error(request.id, -32004, versionError);
      return;
    }

    if (request.jsonrpc !== "2.0") {
      yield error(request.id, -32600, "Invalid JSON-RPC request.");
      return;
    }

    switch (request.method) {
      case "SendStreamingMessage":
      case "message/stream": {
        const response = await this.sendMessage(request);
        if (response.error !== undefined) {
          yield response;
          return;
        }

        const result = isRecord(response.result) ? response.result : undefined;
        const message = result?.message ?? result;
        yield {
          jsonrpc: "2.0",
          id: request.id,
          result: {
            message: normalizeAgentMessage(message, "a2a-stream-response-" + String(request.id)),
          },
        };
        return;
      }
      case "SubscribeToTask":
      case "tasks/subscribe":
      case "tasks/resubscribe":
        yield* this.subscribeToTask(request, signal);
        return;
      default:
        yield error(request.id, -32601, "A2A streaming method is not supported.");
    }
  }

  agentCard(baseUrl: string): Record<string, unknown> {
    const agents = this.dependencies.agents.list().filter((agent) => agent.status === "ACTIVE");
    const endpoint = baseUrl.replace(/\/$/u, "") + "/api/a2a";

    return {
      protocolVersion: "1.0.0",
      name: "POLYON",
      description: "Personal AI Operations Network",
      supportedInterfaces: [
        {
          url: endpoint,
          protocolBinding: "JSONRPC",
          protocolVersion: A2A_PROTOCOL_VERSION,
        },
      ],
      version: "0.1.0",
      capabilities: {
        streaming: true,
        pushNotifications: this.dependencies.pushNotifications !== undefined,
        extendedAgentCard: true,
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
          httpAuthSecurityScheme: {
            scheme: "Bearer",
          },
        },
      },
    };
  }

  extendedAgentCard(baseUrl: string): Record<string, unknown> {
    return this.agentCard(baseUrl);
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
    if (
      task === undefined ||
      !isTaskVisible(task, this.dependencies.actorId, this.dependencies.executions.list())
    ) {
      return error(request.id, -32001, "Task not found.");
    }

    return {
      jsonrpc: "2.0",
      id: request.id,
      result: mapTask(task),
    };
  }

  private cancelTask(request: A2AJsonRpcRequest): A2AJsonRpcResponse {
    const params = request.params ?? {};
    const taskId =
      typeof params.id === "string"
        ? params.id.trim()
        : typeof params.taskId === "string"
          ? params.taskId.trim()
          : "";

    if (taskId === "") return error(request.id, -32602, "Task id is required.");

    const task = this.dependencies.tasks.get(taskId);
    const executions = this.dependencies.executions.list();

    if (task === undefined || !isTaskVisible(task, this.dependencies.actorId, executions)) {
      return error(request.id, -32001, "Task not found.");
    }

    const execution = executions
      .filter(
        (candidate) =>
          candidate.taskId === task.id &&
          candidate.actorId === this.dependencies.actorId &&
          (candidate.status === "QUEUED" || candidate.status === "RUNNING"),
      )
      .sort(compareExecutions)[0];

    if (execution === undefined) {
      return error(request.id, -32002, "Task cannot be canceled.");
    }

    const cancellation = this.dependencies.runtime.cancel(execution.id);

    if (cancellation.status === "NOT_FOUND") {
      return error(request.id, -32001, "Task not found.");
    }

    if (cancellation.status === "NOT_CANCELLABLE") {
      return error(request.id, -32002, "Task cannot be canceled.");
    }

    const updatedTask = this.dependencies.tasks.get(task.id);
    if (updatedTask === undefined) {
      return error(request.id, -32001, "Task not found.");
    }

    return {
      jsonrpc: "2.0",
      id: request.id,
      result: mapTask(updatedTask),
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

    const executions = this.dependencies.executions.list();
    const filtered = this.dependencies.tasks
      .list()
      .filter((task) => isTaskVisible(task, this.dependencies.actorId, executions))
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

  private async *subscribeToTask(
    request: A2AJsonRpcRequest,
    signal?: AbortSignal,
  ): AsyncIterable<A2AJsonRpcResponse> {
    const params = request.params ?? {};
    const taskId =
      typeof params.id === "string"
        ? params.id.trim()
        : typeof params.taskId === "string"
          ? params.taskId.trim()
          : "";

    if (taskId === "") {
      yield error(request.id, -32602, "Task id is required.");
      return;
    }

    const visible = (): Task | undefined => {
      const task = this.dependencies.tasks.get(taskId);
      if (
        task === undefined ||
        !isTaskVisible(task, this.dependencies.actorId, this.dependencies.executions.list())
      ) {
        return undefined;
      }
      return task;
    };

    let task = visible();
    if (task === undefined) {
      yield error(request.id, -32001, "Task not found.");
      return;
    }

    if (isTerminalTask(task)) {
      yield error(
        request.id,
        -32004,
        "Task subscription is not supported for terminal tasks.",
      );
      return;
    }

    yield {
      jsonrpc: "2.0",
      id: request.id,
      result: { task: mapTask(task) },
    };

    const deadline = this.now() + this.streamMaxDurationMs;

    while (!isTerminalTask(task) && this.now() < deadline) {
      if (signal?.aborted) return;

      await this.wait(this.streamPollIntervalMs);
      if (signal?.aborted) return;

      const current = visible();
      if (current === undefined) {
        yield error(request.id, -32001, "Task not found.");
        return;
      }

      if (current.updatedAt !== task.updatedAt || current.status !== task.status) {
        task = current;
        yield {
          jsonrpc: "2.0",
          id: request.id,
          result: { statusUpdate: mapTaskStatusUpdate(task) },
        };

        if (isTerminalTask(task)) return;
      }
    }

    if (!isTerminalTask(task) && !signal?.aborted) {
      yield error(request.id, -32603, "A2A stream deadline exceeded.");
    }
  }

  private createPushNotificationConfig(request: A2AJsonRpcRequest): A2AJsonRpcResponse {
    const service = this.dependencies.pushNotifications;
    if (service === undefined) {
      return error(request.id, -32004, "A2A push notifications are not supported.");
    }

    const params = request.params ?? {};
    const taskId = readRequiredString(params.taskId);
    const url = readRequiredString(params.url);
    if (taskId === "" || url === "") {
      return error(request.id, -32602, "taskId and url are required.");
    }

    try {
      const config = service.createConfig({
        taskId,
        url,
        ...(typeof params.token === "string" ? { token: params.token } : {}),
        ...parsePushAuthentication(params.authentication),
      });
      return { jsonrpc: "2.0", id: request.id, result: redactPushConfig(config) };
    } catch (cause) {
      return error(
        request.id,
        cause instanceof Error ? -32602 : -32000,
        cause instanceof Error
          ? cause.message
          : "Unable to create push notification configuration.",
      );
    }
  }

  private getPushNotificationConfig(request: A2AJsonRpcRequest): A2AJsonRpcResponse {
    const service = this.dependencies.pushNotifications;
    if (service === undefined) {
      return error(request.id, -32004, "A2A push notifications are not supported.");
    }

    const params = request.params ?? {};
    const taskId = readRequiredString(params.taskId);
    const configId = readRequiredString(params.id);
    if (taskId === "" || configId === "") {
      return error(request.id, -32602, "taskId and id are required.");
    }

    const config = service.getConfig(taskId, configId);
    if (config === undefined) {
      return error(request.id, -32001, "Push notification configuration not found.");
    }
    return { jsonrpc: "2.0", id: request.id, result: redactPushConfig(config) };
  }

  private listPushNotificationConfigs(request: A2AJsonRpcRequest): A2AJsonRpcResponse {
    const service = this.dependencies.pushNotifications;
    if (service === undefined) return error(request.id, -32004, "A2A push notifications are not supported.");

    const params = request.params ?? {};
    const taskId = readRequiredString(params.taskId);
    if (taskId === "") return error(request.id, -32602, "taskId is required.");

    const rawPageSize = params.pageSize;
    const pageSize = rawPageSize === undefined ? DEFAULT_TASK_PAGE_SIZE : Number(rawPageSize);
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_TASK_PAGE_SIZE) {
      return error(request.id, -32602, "pageSize must be between 1 and 100.");
    }

    const pageToken = decodePushPageToken(params.pageToken);
    if (pageToken.error !== undefined) return error(request.id, -32602, pageToken.error);

    const configs = service
      .listConfigs(taskId)
      .sort((left, right) => left.id.localeCompare(right.id));
    const startIndex =
      pageToken.configId === undefined
        ? 0
        : configs.findIndex((config) => config.id === pageToken.configId) + 1;
    if (pageToken.configId !== undefined && startIndex === 0) {
      return error(request.id, -32602, "A2A push notification page token is out of range.");
    }

    const page = configs.slice(startIndex, startIndex + pageSize);
    const nextPageToken =
      startIndex + page.length < configs.length && page.length > 0
        ? encodePushPageToken(page[page.length - 1]!.id)
        : "";

    return {
      jsonrpc: "2.0",
      id: request.id,
      result: {
        configs: page.map(redactPushConfig),
        nextPageToken,
      },
    };
  }

  private deletePushNotificationConfig(request: A2AJsonRpcRequest): A2AJsonRpcResponse {
    const service = this.dependencies.pushNotifications;
    if (service === undefined) return error(request.id, -32004, "A2A push notifications are not supported.");

    const params = request.params ?? {};
    const taskId = readRequiredString(params.taskId);
    const configId = readRequiredString(params.id);
    if (taskId === "" || configId === "") {
      return error(request.id, -32602, "taskId and id are required.");
    }

    if (!service.deleteConfig(taskId, configId)) {
      return error(request.id, -32001, "Push notification configuration not found.");
    }
    return { jsonrpc: "2.0", id: request.id, result: {} };
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
        message: {
          messageId: result.persistedMessages[0]?.id ?? "a2a-response-" + String(request.id),
          contextId: "a2a-" + String(request.id),
          role: "ROLE_AGENT",
          parts: [{ text: result.persistedMessages[0]?.content ?? "" }],
        },
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

function mapTaskStatusUpdate(task: Task): Record<string, unknown> {
  return {
    taskId: task.id,
    contextId: task.missionId,
    status: {
      state: mapTaskState(task.status),
      timestamp: task.updatedAt,
    },
  };
}

function normalizeAgentMessage(
  value: unknown,
  fallbackMessageId: string,
): Record<string, unknown> {
  if (!isRecord(value)) {
    return {
      messageId: fallbackMessageId,
      role: "ROLE_AGENT",
      parts: [{ text: "" }],
    };
  }

  const parts = Array.isArray(value.parts)
    ? value.parts
        .map((part) => {
          if (!isRecord(part) || typeof part.text !== "string") return undefined;
          return { text: part.text };
        })
        .filter((part): part is { text: string } => part !== undefined)
    : [];

  return {
    messageId:
      typeof value.messageId === "string" && value.messageId.trim() !== ""
        ? value.messageId
        : fallbackMessageId,
    ...(typeof value.contextId === "string" && value.contextId.trim() !== ""
      ? { contextId: value.contextId }
      : {}),
    role: "ROLE_AGENT",
    parts,
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

function isTerminalTask(task: Task): boolean {
  return (
    task.status === "SUCCEEDED" ||
    task.status === "FAILED" ||
    task.status === "CANCELLED" ||
    task.status === "REJECTED"
  );
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

function isTaskVisible(task: Task, actorId: string, executions: readonly Execution[]): boolean {
  return executions.some(
    (execution) => execution.taskId === task.id && execution.actorId === actorId,
  );
}

function compareTasks(left: Task, right: Task): number {
  const byUpdatedAt = right.updatedAt.localeCompare(left.updatedAt);
  return byUpdatedAt !== 0 ? byUpdatedAt : right.id.localeCompare(left.id);
}

function compareExecutions(left: Execution, right: Execution): number {
  const byUpdatedAt = right.updatedAt.localeCompare(left.updatedAt);
  return byUpdatedAt !== 0 ? byUpdatedAt : right.id.localeCompare(left.id);
}

function encodeTaskPageToken(task: Task): string {
  return "a2a-tasks:" + encodeURIComponent(task.updatedAt) + ":" + encodeURIComponent(task.id);
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

function validateVersion(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === "" || value.trim() === A2A_PROTOCOL_VERSION) {
    return undefined;
  }

  if (value.trim() === "1.0.0") return undefined;
  return "A2A protocol version 1.0 is required.";
}

function validateNonNegativeNumber(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(field + " must be a finite non-negative number.");
  }
}

function validatePositiveNumber(value: number, field: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(field + " must be a positive finite number.");
  }
}

function defaultWait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, milliseconds);
  });
}

function error(id: string | number | null, code: number, message: string): A2AJsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}


function readRequiredString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parsePushAuthentication(value: unknown):
  | { readonly authentication: { readonly scheme: string; readonly credentials: string } }
  | Record<string, never> {
  if (value === undefined) return {};
  if (
    !isRecord(value) ||
    typeof value.scheme !== "string" ||
    typeof value.credentials !== "string"
  ) {
    throw new Error("authentication must contain scheme and credentials.");
  }
  return { authentication: { scheme: value.scheme, credentials: value.credentials } };
}

function redactPushConfig(config: {
  readonly id: string;
  readonly taskId: string;
  readonly url: string;
  readonly token?: string;
  readonly authentication?: { readonly scheme: string; readonly credentials: string };
}): Record<string, unknown> {
  return {
    id: config.id,
    taskId: config.taskId,
    url: config.url,
    ...(config.token === undefined ? {} : { token: config.token }),
    ...(config.authentication === undefined
      ? {}
      : { authentication: { scheme: config.authentication.scheme } }),
  };
}


function encodePushPageToken(configId: string): string {
  return "a2a-push-config:" + encodeURIComponent(configId);
}

function decodePushPageToken(value: unknown): {
  readonly configId?: string;
  readonly error?: string;
} {
  if (value === undefined) return {};
  if (typeof value !== "string" || !value.startsWith("a2a-push-config:")) {
    return { error: "A2A push notification page token is invalid." };
  }
  try {
    const configId = decodeURIComponent(value.slice("a2a-push-config:".length));
    return configId === ""
      ? { error: "A2A push notification page token is invalid." }
      : { configId };
  } catch {
    return { error: "A2A push notification page token is invalid." };
  }
}
