import type {
  A2APushNotificationAuthentication,
  A2APushNotificationConfig,
  Task,
} from "@polyon/contracts";
import type { A2APushNotificationConfigStore } from "@polyon/storage";

export type { A2APushNotificationAuthentication, A2APushNotificationConfig };

export type A2ATaskPushNotificationConfig = Omit<A2APushNotificationConfig, "ownerId">;

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
  list(
    ownerId: string,
    taskId: string,
  ): readonly A2ATaskPushNotificationConfig[];
  delete(ownerId: string, taskId: string, configId: string): boolean;
}

export interface A2APushNotificationSender {
  send(
    config: A2ATaskPushNotificationConfig,
    payload: Record<string, unknown>,
  ): Promise<void>;
}

export interface A2APushNotificationServiceOptions {
  readonly store: A2APushNotificationStore;
  readonly sender: A2APushNotificationSender;
  readonly ownerId: string;
  readonly validateTask: (taskId: string) => boolean;
  readonly maxDeliveryAttempts?: number;
  readonly retryBackoffInitialMs?: number;
  readonly retryBackoffMaxMs?: number;
  readonly wait?: (delayMs: number) => Promise<void>;
  readonly onDeliveryOutcome?: (outcome: {
    readonly status: "SUCCEEDED" | "FAILED";
    readonly taskId: string;
    readonly configId: string;
    readonly attempts: number;
    readonly error?: string;
  }) => void | Promise<void>;
}

export class A2APushNotificationDeliveryError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message);
    this.name = "A2APushNotificationDeliveryError";
  }
}

export class InMemoryA2APushNotificationStore implements A2APushNotificationStore {
  private sequence = 0;
  private readonly records = new Map<
    string,
    { ownerId: string; config: A2ATaskPushNotificationConfig }
  >();

  create(ownerId: string, input: Omit<A2ATaskPushNotificationConfig, "id">) {
    const id = "a2a-push:" + String(++this.sequence);
    const config = { ...input, id };
    this.records.set(id, { ownerId, config });
    return config;
  }

  get(ownerId: string, taskId: string, configId: string) {
    const record = this.records.get(configId);
    return record?.ownerId === ownerId && record.config.taskId === taskId
      ? record.config
      : undefined;
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
    if (!this.options.validateTask(input.taskId)) {
      throw new Error("Task not found.");
    }
    return this.options.store.create(this.options.ownerId, input);
  }

  getConfig(taskId: string, configId: string) {
    if (!this.options.validateTask(taskId)) return undefined;
    return this.options.store.get(this.options.ownerId, taskId, configId);
  }

  listConfigs(taskId: string) {
    if (!this.options.validateTask(taskId)) return [];
    return this.options.store.list(this.options.ownerId, taskId);
  }

  deleteConfig(taskId: string, configId: string) {
    if (!this.options.validateTask(taskId)) return false;
    return this.options.store.delete(this.options.ownerId, taskId, configId);
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
        const maxAttempts = Math.max(
          1,
          Math.min(10, Math.floor(this.options.maxDeliveryAttempts ?? 3)),
        );
        const initialDelay = Math.max(0, this.options.retryBackoffInitialMs ?? 250);
        const maxDelay = Math.max(initialDelay, this.options.retryBackoffMaxMs ?? 2_000);
        const wait = this.options.wait ?? ((delayMs: number) => new Promise<void>((resolve) => setTimeout(resolve, delayMs)));

        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
          try {
            await this.options.sender.send(config, payload);
            await this.options.onDeliveryOutcome?.({
              status: "SUCCEEDED",
              taskId: task.id,
              configId: config.id,
              attempts: attempt,
            });
            return;
          } catch (error) {
            const retryable =
              error instanceof A2APushNotificationDeliveryError
                ? error.retryable
                : true;
            if (!retryable || attempt === maxAttempts) {
              await this.options.onDeliveryOutcome?.({
                status: "FAILED",
                taskId: task.id,
                configId: config.id,
                attempts: attempt,
                error: error instanceof Error ? error.message : "A2A push delivery failed.",
              });
              return;
            }

            const delay = Math.min(
              maxDelay,
              initialDelay * 2 ** (attempt - 1),
            );
            await wait(delay);
          }
        }
      }),
    );
  }
}

export function createDurableA2APushNotificationStore(
  store: A2APushNotificationConfigStore,
): A2APushNotificationStore {
  return {
    create(ownerId, input) {
      const id = "a2a-push:" + crypto.randomUUID();
      const config = { ...input, id, ownerId };
      store.save(config);
      return stripOwner(config);
    },
    get(ownerId, taskId, configId) {
      const config = store.get(configId);
      return config !== undefined &&
          config.ownerId === ownerId &&
          config.taskId === taskId
        ? stripOwner(config)
        : undefined;
    },
    list(ownerId, taskId) {
      return store
        .list()
        .filter(
          (config) =>
            config.ownerId === ownerId && config.taskId === taskId,
        )
        .map(stripOwner);
    },
    delete(ownerId, taskId, configId) {
      const config = store.get(configId);
      return config !== undefined &&
          config.ownerId === ownerId &&
          config.taskId === taskId
        ? store.delete(configId)
        : false;
    },
  };
}

function stripOwner(
  config: A2APushNotificationConfig,
): A2ATaskPushNotificationConfig {
  const { ownerId: _ownerId, ...publicConfig } = config;
  return publicConfig;
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
      if (!allowed.has(origin)) {
        throw new Error("A2A push URL is not allowlisted.");
      }

      const headers = new Headers({ "content-type": "application/a2a+json" });
      if (config.token !== undefined) {
        headers.set("X-A2A-Notification-Token", config.token);
      }
      if (config.authentication !== undefined) {
        const scheme = config.authentication.scheme.trim();
        if (
          scheme === "" ||
          /[\r
]/.test(scheme) ||
          /[\r
]/.test(config.authentication.credentials)
        ) {
          throw new Error("Invalid A2A push authentication.");
        }
        headers.set("Authorization", scheme + " " + config.authentication.credentials);
      }

      const body = JSON.stringify(payload);
      if (new TextEncoder().encode(body).byteLength > 256_000) {
        throw new Error("A2A push payload exceeds its byte limit.");
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);
      try {
        const response = await fetchImpl(url, {
          method: "POST",
          headers,
          body,
          signal: controller.signal,
        });
        if (!response.ok) {
          const retryable =
            response.status === 408 ||
            response.status === 425 ||
            response.status === 429 ||
            response.status >= 500;
          throw new A2APushNotificationDeliveryError(
            "A2A push webhook returned HTTP " + String(response.status) + ".",
            retryable,
            response.status,
          );
        }
      } catch (error) {
        if (error instanceof A2APushNotificationDeliveryError) throw error;
        throw new A2APushNotificationDeliveryError(
          error instanceof Error ? error.message : "A2A push webhook delivery failed.",
          true,
        );
      } finally {
        clearTimeout(timeout);
      }
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
    if (
      config.authentication.scheme.trim() === "" ||
      config.authentication.credentials.length > 4096
    ) {
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
