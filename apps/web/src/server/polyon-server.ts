import { join } from "node:path";

import type { Model, Policy, Provider, SecretReference } from "@polyon/contracts";
import {
  BoundedHttpClient,
  EnvironmentSecretResolver,
  SmtpTransport,
  type EmailTransport,
} from "@polyon/integrations";
import { OpenAICompatibleEmbeddingAdapter, UsageGovernor } from "@polyon/providers";
import { EncryptedFileSecretResolver, NodeSmtpConnectionFactory } from "@polyon/runtime";
import {
  BoundedHttpBrowserProvider,
  BoundedWebResearchRetriever,
  ConfiguredHttpCreativeAdapter,
  ConfiguredHttpResearchProvider,
  createPolyonComposition,
  type PolyonComposition,
} from "@polyon/application";
import {
  buildModelRegistrations,
  parseModelProfiles,
  type ModelProfileConfig,
} from "./model-fleet-config";

const globalState = globalThis as typeof globalThis & { __polyonComposition?: PolyonComposition };

export function getPolyonActorId(): string {
  const actorId = process.env.POLYON_ACTOR_ID?.trim();
  return actorId === undefined || actorId === "" ? "local-user" : actorId;
}

export function getPolyonComposition(): PolyonComposition {
  if (globalState.__polyonComposition !== undefined) return globalState.__polyonComposition;
  const composition = createPolyonComposition(buildOptions());
  if (process.env.POLYON_RUNTIME_AUTOSTART !== "false") composition.runtime.start();
  if (process.env.POLYON_JOB_RUNTIME_AUTOSTART !== "false") composition.jobRuntime.start();
  if (process.env.POLYON_SEMANTIC_INDEXING_AUTOSTART !== "false") {
    composition.semanticMemoryIndexer?.start();
  }
  globalState.__polyonComposition = composition;
  return composition;
}

function buildOptions() {
  const model = buildConfiguredModelRegistrations();
  const embedding = buildEmbeddingRegistration();
  const email = buildEmailRegistration();
  const googleDrive = buildGoogleDriveRegistration();
  const telegram = buildTelegramRegistration();
  const secretResolver =
    email === undefined && googleDrive === undefined && telegram === undefined
      ? undefined
      : buildSecretResolver();
  const research = buildResearchRetriever();
  const creativeAdapter = buildCreativeAdapter();
  const usageGovernor = buildUsageGovernor();
  const semanticMemoryIndexAllowedScopes = parseMemoryScopes(
    process.env.POLYON_SEMANTIC_INDEX_ALLOWED_SCOPES,
  );
  const a2aPushNotificationAllowedOrigins = parseCsv(process.env.POLYON_A2A_PUSH_ALLOWED_ORIGINS);
  const configuredDataDir = process.env.POLYON_DATA_DIR?.trim();
  const storageRoot =
    process.env.VERCEL === "1"
      ? join("/tmp", "polyon-data")
      : configuredDataDir || join(process.cwd(), ".polyon-data");

  return {
    storageRoot,
    ...(model === undefined
      ? {}
      : { agents: model.agents, models: model.models, providers: model.providers }),
    ...(embedding === undefined ? {} : { embeddingProvider: embedding }),
    ...(secretResolver === undefined ? {} : { secretResolver }),
    ...(research === undefined
      ? {}
      : {
          researchRetriever: research.retriever,
          researchFabricProviders: research.providers,
        }),
    ...(creativeAdapter === undefined ? {} : { creativeAdapter }),
    usageGovernor,
    semanticMemoryIndexAllowedScopes,
    semanticMemoryIndexingEnabled: semanticMemoryIndexAllowedScopes.length > 0,
    semanticMemoryIndexJobUserId: getPolyonActorId(),
    ...(a2aPushNotificationAllowedOrigins.length === 0
      ? {}
      : { a2aPushNotificationAllowedOrigins }),
    ...(googleDrive === undefined
      ? {}
      : {
          googleDriveIntegrationId: "google-drive-primary",
          googleDriveSecretReference: googleDrive.secretReference,
        }),
    ...(telegram === undefined
      ? {}
      : {
          telegramIntegrationId: "telegram-primary",
          telegramSecretReference: telegram.secretReference,
        }),
    ...(email === undefined
      ? {}
      : {
          emailIntegrationId: "email-primary",
          emailSecretReference: email.secretReference,
          emailSmtpUsername: email.username,
          emailTransport: email.transport,
        }),
  };
}

function buildGoogleDriveRegistration():
  | { secretReference: SecretReference }
  | undefined {
  const accessToken = process.env.POLYON_GOOGLE_DRIVE_ACCESS_TOKEN?.trim();
  if (accessToken === undefined || accessToken === "") return undefined;

  return {
    secretReference: {
      id: "google-drive.primary",
      kind: "OAUTH_ACCESS_TOKEN",
      provider: "google",
    },
  };
}

function buildTelegramRegistration():
  | { secretReference: SecretReference }
  | undefined {
  const botToken = process.env.POLYON_TELEGRAM_BOT_TOKEN?.trim();
  if (botToken === undefined || botToken === "") return undefined;

  return {
    secretReference: {
      id: "telegram.primary",
      kind: "API_KEY",
      provider: "telegram",
    },
  };
}

function buildEmbeddingRegistration() {
  const endpoint = process.env.POLYON_EMBEDDING_ENDPOINT?.trim();
  const modelId = process.env.POLYON_EMBEDDING_MODEL_ID?.trim();
  if (endpoint === undefined || endpoint === "" || modelId === undefined || modelId === "")
    return undefined;

  const providerId =
    process.env.POLYON_EMBEDDING_PROVIDER_ID?.trim() || "configured-embedding-provider";
  const model: Model = {
    id: modelId,
    providerId,
    name: process.env.POLYON_EMBEDDING_MODEL_NAME?.trim() || modelId,
    kind: "EMBEDDING",
    capabilityIds: [],
    enabled: true,
  };
  const provider: Provider = {
    id: providerId,
    name: process.env.POLYON_EMBEDDING_PROVIDER_NAME?.trim() || "Configured embedding provider",
    kind: "HOSTED_MODEL",
    enabled: true,
  };
  const adapter = new OpenAICompatibleEmbeddingAdapter({
    providerId,
    endpoint,
    ...(process.env.POLYON_EMBEDDING_API_KEY === undefined
      ? {}
      : { apiKey: process.env.POLYON_EMBEDDING_API_KEY }),
  });

  return { provider, model, adapter };
}

function buildConfiguredModelRegistrations() {
  const profilesJson = process.env.POLYON_MODEL_PROFILES_JSON?.trim();
  if (profilesJson !== undefined && profilesJson !== "") {
    return buildModelRegistrations(parseModelProfiles(profilesJson), process.env);
  }

  const endpoint = process.env.POLYON_MODEL_ENDPOINT?.trim();
  const modelId = process.env.POLYON_MODEL_ID?.trim();
  if (endpoint === undefined || endpoint === "" || modelId === undefined || modelId === "")
    return undefined;

  const providerId = process.env.POLYON_PROVIDER_ID?.trim() || "configured-model-provider";
  const baseAgentId = process.env.POLYON_AGENT_ID?.trim() || "primary";
  const profile: ModelProfileConfig = {
    agentId: baseAgentId,
    agentName: process.env.POLYON_AGENT_NAME?.trim() || "Primary",
    agentRole: process.env.POLYON_AGENT_ROLE?.trim() || "General operations",
    agentDescription: "Server-configured POLYON agent.",
    modelId,
    modelName: process.env.POLYON_MODEL_NAME?.trim() || modelId,
    providerId,
    providerName: process.env.POLYON_PROVIDER_NAME?.trim() || "Configured model provider",
    endpoint,
    apiKeyEnv: "POLYON_MODEL_API_KEY",
    ...(process.env.POLYON_MODEL_SUPPORTS_TOOLS === undefined ||
    process.env.POLYON_MODEL_SUPPORTS_TOOLS.trim() === ""
      ? {}
      : { supportsTools: readBoolean(process.env.POLYON_MODEL_SUPPORTS_TOOLS.trim(), false) }),
  };

  if ((process.env.POLYON_COLLECTIVE_PRESET?.trim() || "default").toLowerCase() !== "default") {
    return buildModelRegistrations([profile], process.env);
  }

  const roles = [
    {
      id: "planner",
      roleId: "planner" as const,
      name: "Planner",
      role: "Planner",
      description: "Breaks user goals into bounded, executable plans.",
    },
    {
      id: "researcher",
      roleId: "researcher" as const,
      name: "Researcher",
      role: "Researcher",
      description: "Finds relevant facts, sources, context, and information gaps.",
    },
    {
      id: "analyst",
      roleId: "analyst" as const,
      name: "Analyst",
      role: "Analyst",
      description: "Compares evidence, explanations, patterns, and implications.",
    },
    {
      id: "specialist",
      roleId: "specialist" as const,
      name: "Specialist",
      role: "Specialist",
      description: "Applies focused domain expertise to a bounded problem.",
    },
    {
      id: "critic",
      roleId: "critic" as const,
      name: "Critic",
      role: "Critic",
      description: "Challenges weak reasoning, edge cases, and overconfident conclusions.",
    },
    {
      id: "fact-checker",
      roleId: "fact-checker" as const,
      name: "Fact Checker",
      role: "Fact Checker",
      description: "Tests claims against supplied evidence and identifies verification gaps.",
    },
    {
      id: "judge",
      roleId: "judge" as const,
      name: "Judge",
      role: "Judge",
      description: "Adjudicates bounded disagreements and records uncertainty.",
    },
    {
      id: "synthesizer",
      roleId: "synthesizer" as const,
      name: "Synthesizer",
      role: "Synthesizer",
      description: "Combines independent findings into a transparent final response.",
    },
    {
      id: "action-agent",
      roleId: "action-agent" as const,
      name: "Action Agent",
      role: "Action Agent",
      description: "Executes approved actions through governed tools and integrations.",
    },
  ];

  return buildModelRegistrations(
    roles.map((role) => ({
      ...profile,
      agentId: baseAgentId + "-" + role.id,
      agentRoleId: role.roleId,
      agentName: role.name,
      agentRole: role.role,
      agentDescription: role.description,
    })),
    process.env,
  );
}

function buildEmailRegistration():
  { username: string; secretReference: SecretReference; transport: EmailTransport } | undefined {
  const host = process.env.POLYON_SMTP_HOST?.trim();
  const username = process.env.POLYON_SMTP_USERNAME?.trim();
  const port = readInteger(process.env.POLYON_SMTP_PORT, 465);
  if (host === undefined || host === "" || username === undefined || username === "")
    return undefined;
  const secretReference: SecretReference = {
    id: "email.primary",
    kind: "SMTP_CREDENTIAL",
    provider: "email",
  };
  const transport = new SmtpTransport(
    {
      host,
      port,
      secure: readBoolean(process.env.POLYON_SMTP_SECURE, port === 465),
      startTls: readBoolean(process.env.POLYON_SMTP_STARTTLS, port === 587),
      heloName: process.env.POLYON_SMTP_HELO_NAME?.trim() || "polyon.local",
      messageIdDomain: process.env.POLYON_SMTP_MESSAGE_ID_DOMAIN?.trim() || "polyon.local",
    },
    new NodeSmtpConnectionFactory(),
  );
  return { username, secretReference, transport };
}

function buildResearchRetriever():
  | {
      retriever: BoundedWebResearchRetriever;
      providers: readonly [ConfiguredHttpResearchProvider, BoundedHttpBrowserProvider];
    }
  | undefined {
  const endpoint = process.env.POLYON_RESEARCH_SEARCH_ENDPOINT?.trim();
  const allowedHosts = (process.env.POLYON_RESEARCH_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((host) => host.trim())
    .filter(Boolean);

  if (endpoint === undefined || endpoint === "" || allowedHosts.length === 0) return undefined;

  let endpointHost: string;
  try {
    const parsed = new URL(endpoint);
    if (parsed.protocol !== "https:") throw new Error("research endpoint must use HTTPS");
    endpointHost = parsed.hostname;
  } catch {
    throw new Error("POLYON_RESEARCH_SEARCH_ENDPOINT must be a valid HTTPS URL.");
  }

  const http = new BoundedHttpClient({
    allowedHosts: [...new Set([endpointHost, ...allowedHosts])],
    defaultTimeoutMs: 15_000,
    maxTimeoutMs: 30_000,
    defaultMaxResponseBytes: 256_000,
    maxResponseBytes: 1_000_000,
    defaultMaxRequestBytes: 16_384,
    maxRequestBytes: 16_384,
  });

  const searchProvider = new ConfiguredHttpResearchProvider({
    endpoint,
    http,
  });
  const browserProvider = new BoundedHttpBrowserProvider(http, {
    maxResponseBytes: 100_000,
  });
  const retriever = new BoundedWebResearchRetriever(searchProvider, http, {
    maxContentBytes: 100_000,
  });

  return {
    retriever,
    providers: [searchProvider, browserProvider],
  };
}

function buildCreativeAdapter() {
  const endpointByOperation = {
    IMAGE: process.env.POLYON_CREATIVE_IMAGE_ENDPOINT?.trim(),
    VIDEO: process.env.POLYON_CREATIVE_VIDEO_ENDPOINT?.trim(),
    AUDIO: process.env.POLYON_CREATIVE_AUDIO_ENDPOINT?.trim(),
    VOICE: process.env.POLYON_CREATIVE_VOICE_ENDPOINT?.trim(),
    EDIT: process.env.POLYON_CREATIVE_EDIT_ENDPOINT?.trim(),
  };

  const configured = Object.values(endpointByOperation).filter(
    (value): value is string => value !== undefined && value !== "",
  );
  if (configured.length === 0) return undefined;

  const hosts = new Set<string>();
  for (const endpoint of configured) {
    try {
      const url = new URL(endpoint);
      if (url.protocol !== "https:") {
        throw new Error("creative endpoint must use HTTPS");
      }
      hosts.add(url.hostname);
    } catch {
      throw new Error("POLYON creative endpoints must be valid HTTPS URLs.");
    }
  }

  const http = new BoundedHttpClient({
    allowedHosts: [...hosts],
    defaultTimeoutMs: 30_000,
    maxTimeoutMs: 120_000,
    defaultMaxResponseBytes: 128_000,
    maxResponseBytes: 1_000_000,
    defaultMaxRequestBytes: 32_768,
    maxRequestBytes: 32_768,
  });

  return new ConfiguredHttpCreativeAdapter({
    endpointByOperation,
    http,
  });
}

function parseMemoryScopes(value: string | undefined): import("@polyon/contracts").MemoryScope[] {
  if (value === undefined || value.trim() === "") return [];

  const allowed = new Set<import("@polyon/contracts").MemoryScope>([
    "PRIVATE",
    "PROJECT",
    "MISSION",
    "TASK",
  ]);
  const values = [
    ...new Set(
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];

  for (const item of values) {
    if (!allowed.has(item as import("@polyon/contracts").MemoryScope)) {
      throw new Error("POLYON_SEMANTIC_INDEX_ALLOWED_SCOPES contains an invalid memory scope.");
    }
  }

  return values as import("@polyon/contracts").MemoryScope[];
}

function buildSecretResolver() {
  const masterKeyBase64 = process.env.POLYON_SECRET_MASTER_KEY_BASE64?.trim();
  const storePath = process.env.POLYON_SECRET_STORE_PATH?.trim();
  if (
    masterKeyBase64 !== undefined &&
    masterKeyBase64 !== "" &&
    storePath !== undefined &&
    storePath !== ""
  ) {
    return new EncryptedFileSecretResolver({
      filePath: storePath,
      masterKey: Buffer.from(masterKeyBase64, "base64"),
    });
  }
  return new EnvironmentSecretResolver({
    environment: process.env,
    references: {
      "email.primary": {
        provider: "email",
        kind: "SMTP_CREDENTIAL",
        environmentVariable: "POLYON_SMTP_PASSWORD",
      },
      "google-drive.primary": {
        provider: "google",
        kind: "OAUTH_ACCESS_TOKEN",
        environmentVariable: "POLYON_GOOGLE_DRIVE_ACCESS_TOKEN",
      },
      "telegram.primary": {
        provider: "telegram",
        kind: "API_KEY",
        environmentVariable: "POLYON_TELEGRAM_BOT_TOKEN",
      },
      "google-drive.primary": {
        provider: "google",
        kind: "OAUTH_ACCESS_TOKEN",
        environmentVariable: "POLYON_GOOGLE_DRIVE_ACCESS_TOKEN",
      },
      "telegram.primary": {
        provider: "telegram",
        kind: "API_KEY",
        environmentVariable: "POLYON_TELEGRAM_BOT_TOKEN",
      },
    },
  });
}

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error("POLYON boolean environment values must be true or false.");
}

function readInteger(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed))
    throw new Error("POLYON integer environment values must be integers.");
  return parsed;
}

export function sanitizeEventData(
  data: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    const normalized = key.toLowerCase();
    if (
      normalized.includes("secret") ||
      normalized.includes("password") ||
      normalized.includes("token") ||
      normalized.includes("credential") ||
      normalized.includes("authorization")
    )
      continue;
    safe[key] = value;
  }
  return safe;
}

export function getPolyonPolicy(): Policy {
  const now = new Date().toISOString();
  const approvalMode =
    process.env.POLYON_APPROVAL_MODE === "AUTO" ||
    process.env.POLYON_APPROVAL_MODE === "BALANCED" ||
    process.env.POLYON_APPROVAL_MODE === "ASK_EVERYTHING"
      ? process.env.POLYON_APPROVAL_MODE
      : "ASK_EVERYTHING";

  return {
    id: process.env.POLYON_POLICY_ID?.trim() || "web-default",
    name: "POLYON Web Policy",
    description: "Server policy for the personal POLYON command center.",
    approvalMode,
    rules: [],
    defaultEffect: "REQUIRE_APPROVAL",
    enabled: true,
    createdAt: now,
    updatedAt: now,
  };
}

export function executionEnabled(): boolean {
  return process.env.POLYON_EXECUTION_ENABLED === "true";
}

export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin === null) return true;
  const host = request.headers.get("host");
  if (host === null) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * Protocol endpoints accept both bearer-token clients and the browser session cookie.
 * A cookie-authenticated request must be same-origin JSON, otherwise another local page
 * could ride the session cookie (SameSite does not separate localhost ports).
 */
export function isUntrustedBrowserProtocolRequest(request: Request): boolean {
  if (request.headers.get("authorization")?.startsWith("Bearer ") === true) return false;
  const contentType = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  return !isSameOrigin(request) || contentType !== "application/json";
}

export function getPolyonBaseUrl(request?: Request): string {
  const configured = process.env.POLYON_PUBLIC_BASE_URL?.trim();
  if (configured !== undefined && configured !== "") return configured.replace(/\/$/u, "");
  if (request !== undefined) {
    // Behind Docker or a proxy, request.url carries the bind address (for example 0.0.0.0),
    // which clients cannot reach; the Host / X-Forwarded-* headers carry the public origin.
    const url = new URL(request.url);
    const host =
      firstHeaderValue(request.headers.get("x-forwarded-host")) ??
      firstHeaderValue(request.headers.get("host")) ??
      url.host;
    const protocol =
      firstHeaderValue(request.headers.get("x-forwarded-proto")) ?? url.protocol.replace(/:$/u, "");
    if (
      /^[a-z0-9.-]+(?::\d+)?$|^\[[0-9a-f:]+\](?::\d+)?$/iu.test(host) &&
      /^https?$/u.test(protocol)
    ) {
      return `${protocol}://${host}`;
    }
    return url.origin;
  }
  return "http://localhost:3000";
}

function firstHeaderValue(value: string | null): string | undefined {
  const first = value?.split(",")[0]?.trim();
  return first === undefined || first === "" ? undefined : first;
}

function buildUsageGovernor(): UsageGovernor {
  const rawCostMode = process.env.POLYON_COST_MODE?.trim().toLowerCase();
  const costMode = rawCostMode === "zero" ? "zero" : "configured";

  return new UsageGovernor({
    costMode,
    budgets: parseUsageBudgets(process.env.POLYON_USAGE_BUDGETS_JSON),
  });
}

function parseUsageBudgets(value: string | undefined) {
  if (value === undefined || value.trim() === "") return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error(
      `POLYON_USAGE_BUDGETS_JSON must contain valid JSON: ${
        error instanceof Error ? error.message : "invalid JSON"
      }.`,
      { cause: error },
    );
  }

  if (!Array.isArray(parsed)) {
    throw new Error("POLYON_USAGE_BUDGETS_JSON must contain an array.");
  }

  return parsed.map((item, index) => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`Usage budget at index ${index} must be an object.`);
    }

    const record = item as Record<string, unknown>;
    const providerId = requiredUsageBudgetString(record.providerId, "providerId", index);

    return {
      providerId,
      ...(optionalUsageLimit(record.dailyRequestLimit, "dailyRequestLimit", index) === undefined
        ? {}
        : {
            dailyRequestLimit: optionalUsageLimit(
              record.dailyRequestLimit,
              "dailyRequestLimit",
              index,
            ),
          }),
      ...(optionalUsageLimit(record.monthlyRequestLimit, "monthlyRequestLimit", index) === undefined
        ? {}
        : {
            monthlyRequestLimit: optionalUsageLimit(
              record.monthlyRequestLimit,
              "monthlyRequestLimit",
              index,
            ),
          }),
      ...(optionalUsageLimit(record.maxTokensPerRun, "maxTokensPerRun", index) === undefined
        ? {}
        : {
            maxTokensPerRun: optionalUsageLimit(record.maxTokensPerRun, "maxTokensPerRun", index),
          }),
      ...(optionalUsageLimit(record.maxAgentsPerRun, "maxAgentsPerRun", index) === undefined
        ? {}
        : {
            maxAgentsPerRun: optionalUsageLimit(record.maxAgentsPerRun, "maxAgentsPerRun", index),
          }),
      ...(optionalUsageLimit(record.maxDebateRounds, "maxDebateRounds", index) === undefined
        ? {}
        : {
            maxDebateRounds: optionalUsageLimit(record.maxDebateRounds, "maxDebateRounds", index),
          }),
    };
  });
}

function requiredUsageBudgetString(value: unknown, field: string, index: number): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Usage budget at index ${index} requires a non-empty ${field}.`);
  }
  return value.trim();
}

function optionalUsageLimit(value: unknown, field: string, index: number): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new Error(`Usage budget ${field} at index ${index} must be a non-negative integer.`);
  }
  return value as number;
}

function parseCsv(value: string | undefined): string[] {
  if (value === undefined || value.trim() === "") return [];
  return [
    ...new Set(
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}
