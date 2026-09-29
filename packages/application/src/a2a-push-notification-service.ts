import type { Task } from "@polyon/contracts";

export interface A2APushNotificationAuthentication {
  readonly scheme: string;
  readonly credentials: string;
}

export interface A2ATaskPushNotificationConfig {
  readonly id: string;
  readonly taskId: string;
  readonly url: string;
  readonly token?: string;
  readonly authentication?: A2APushNotificationAuthentication;
}

export interface A2APushNotificationStore {
  create(
    ownerId: string,
    input: Omit<A2ATaskPushNotificationConfig, "id">,
  ): A2ATaskPushNotificationConfig;
  get(
    ownerId: string,
    taskId: string,
    configId: string,
  ): A2ATaskPushNotificationConfig | undefined;
  list(ownerId: string, taskId: string): readonly A2ATaskPushNotificationConfig[];
  delete(ownerId: string, taskId: string, configId: string): boolean;
}

export interface A2APushNotificationSender {
  send(
    config: A2ATaskPushNotificationConfig,
    payload: Record<string, unknown>,
  ): Promise<void>;
}

export interface A2APushNotificationServiceOptions {
  readonly store?: A2APushNotificationStore;
  readonly sender: A2APushNotificationSender;
  readonly ownerId: string;
  readonly validateTask: (taskId: string) => boolean;
}

export class InMemoryA2APushNotificationStore implements A2APushNotificationStore {
  private sequence = 0;
  private readonly records = new Map<string, { ownerId: string; config: A2ATaskPushNotificationConfig }>();

  create(ownerId: string, input: Omit<A2ATaskPushNotificationConfig, "id">) {
    const id = "a2a-push:" + String(++this.sequence);
    const config = { ...input, id };
    this.records.set(id, { ownerId, config });
    return config;
  }

  get(ownerId: string, taskId: string, configId: string) {
    const record = this.records.get(configId);
    return record?.ownerId === ownerId && record.config.taskId === taskId ? record.config : undefined;
  }

  list(ownerId: string, taskId: string) {
    return [...this.records.values()]
      .filter((record) => record.ownerId === ownerId && record.config.taskId === taskId)
      .map((record) => record.config);
  }

  delete(ownerId: string, taskId: string, configId: string) {
    const config = this.get(ownerId, taskId, configId);
    return config !== undefined && this.records.delete(configId);
  }
}

export class A2APushNotificationService {
  constructor(private readonly options: A2APushNotificationServiceOptions) {}

  createConfig(input: Omit<A2ATaskPushNotificationConfig, "id">) {
    validateConfig(input);
    if (!this.options.validateTask(input.taskId)) throw new Error("Task not found.");
    return this.options.store?.create(this.options.ownerId, input) ??
      (() => { throw new Error("Push notification storage is not configured."); })();
  }

  getConfig(taskId: string, configId: string) {
    return this.options.store?.get(this.options.ownerId, taskId, configId);
  }

  listConfigs(taskId: string) {
    return this.options.store?.list(this.options.ownerId, taskId) ?? [];
  }

  deleteConfig(taskId: string, configId: string) {
    return this.options.store?.delete(this.options.ownerId, taskId, configId) ?? false;
  }

  async notifyTask(task: Task): Promise<void> {
    const configs = this.listConfigs(task.id);
    if (configs.length === 0) return;

    const payload = {
      statusUpdate: {
        taskId: task.id,
        contextId: task.missionId,
        status: {
          state: mapTaskState(task.status),
          timestamp: task.updatedAt,
        },
      },
    };

    await Promise.allSettled(
      configs.map(async (config) => {
        try {
          await this.options.sender.send(config, payload);
        } catch {
          // Push delivery is best-effort. The task lifecycle remains authoritative.
        }
      }),
    );
  }
}

export function createA2AWebhookSender(options: {
  readonly allowedOrigins: readonly string[];
  readonly fetchImpl?: typeof fetch;
}): A2APushNotificationSender {
  const fetchImpl = options.fetchImpl ?? fetch;
  const allowed = new Set(options.allowedOrigins.map((origin) => normalizeOrigin(origin)));

  return {
    async send(config, payload) {
      const url = new URL(config.url);
      const origin = normalizeOrigin(url.origin);
      if (!allowed.has(origin)) throw new Error("A2A push URL is not allowlisted.");

      const headers = new Headers({ "content-type": "application/json" });
      if (config.token !== undefined) headers.set("X-A2A-Notification-Token", config.token);
      if (config.authentication !== undefined) {
        const scheme = config.authentication.scheme.trim();
        if (scheme === "" || /[\\r\\n]/.test(scheme) || /[\\r\\n]/.test(config.authentication.credentials)) {
          throw new Error("Invalid A2A push authentication.");
        }
        headers.set("Authorization", scheme + " " + config.authentication.credentials);
      }

      const response = await fetchImpl(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error("A2A push webhook returned HTTP " + String(response.status) + ".");
    },
  };
}

function validateConfig(config: Omit<A2ATaskPushNotificationConfig, "id">): void {
  if (config.taskId.trim() === "") throw new Error("Task id is required.");
  if (config.url.length > 2048) throw new Error("A2A push URL is too long.");

  const url = new URL(config.url);
  if (url.protocol !== "https:" && !isLoopbackHost(url.hostname)) {
    throw new Error("A2A push URL must use HTTPS unless it targets loopback.");
  }

  if (config.authentication !== undefined) {
    if (config.authentication.scheme.trim() === "" || config.authentication.credentials.length > 4096) {
      throw new Error("Invalid A2A push authentication.");
    }
  }
}

function normalizeOrigin(value: string): string {
  return new URL(value).origin;
}

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "[::1]";
}

function mapTaskState(status: Task["status"]): string {
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
