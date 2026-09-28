import { join } from "node:path";

import type { Model, Policy, Provider, SecretReference } from "@polyon/contracts";
import {
  BoundedHttpClient,
  EnvironmentSecretResolver,
  SmtpTransport,
  type EmailTransport,
} from "@polyon/integrations";
import {
  OpenAICompatibleEmbeddingAdapter,
} from "@polyon/providers";
import { EncryptedFileSecretResolver, NodeSmtpConnectionFactory } from "@polyon/runtime";
import {
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
  const secretResolver = email === undefined ? undefined : buildSecretResolver();
  const researchRetriever = buildResearchRetriever();
  const creativeAdapter = buildCreativeAdapter();
  const semanticMemoryIndexAllowedScopes = parseMemoryScopes(
    process.env.POLYON_SEMANTIC_INDEX_ALLOWED_SCOPES,
  );
  return {
    storageRoot: process.env.POLYON_DATA_DIR?.trim() || join(process.cwd(), ".polyon-data"),
    ...(model === undefined
      ? {}
      : { agents: model.agents, models: model.models, providers: model.providers }),
    ...(embedding === undefined ? {} : { embeddingProvider: embedding }),
    ...(secretResolver === undefined ? {} : { secretResolver }),
    ...(researchRetriever === undefined ? {} : { researchRetriever }),
    ...(creativeAdapter === undefined ? {} : { creativeAdapter }),
    semanticMemoryIndexAllowedScopes,
    semanticMemoryIndexingEnabled: semanticMemoryIndexAllowedScopes.length > 0,
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
    return buildModelRegistrations(
      parseModelProfiles(profilesJson),
      process.env,
    );
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
  };

  if ((process.env.POLYON_COLLECTIVE_PRESET?.trim() || "default").toLowerCase() !== "default") {
    return buildModelRegistrations([profile], process.env);
  }

  const roles = [
    {
      id: "researcher",
      name: "Researcher",
      role: "Independent research specialist",
      description: "Finds relevant facts, context, assumptions, and gaps.",
    },
    {
      id: "analyst",
      name: "Analyst",
      role: "Analytical specialist",
      description: "Compares explanations, patterns, trade-offs, and implications.",
    },
    {
      id: "skeptic",
      name: "Skeptic",
      role: "Skeptical fact checker",
      description: "Challenges unsupported claims, hidden assumptions, and overconfidence.",
    },
    {
      id: "synthesizer",
      name: "Synthesizer",
      role: "Collective synthesis lead",
      description: "Compares team findings and produces a transparent final answer.",
    },
  ];

  return buildModelRegistrations(
    roles.map((role) => ({
      ...profile,
      agentId: baseAgentId + "-" + role.id,
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

function buildResearchRetriever() {
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

  const provider = new ConfiguredHttpResearchProvider({ endpoint, http });
  return new BoundedWebResearchRetriever(provider, http, {
    maxContentBytes: 100_000,
  });
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

export function getPolyonBaseUrl(request?: Request): string {
  const configured = process.env.POLYON_PUBLIC_BASE_URL?.trim();
  if (configured !== undefined && configured !== "") return configured.replace(/\/$/u, "");
  if (request !== undefined) {
    const url = new URL(request.url);
    return url.origin;
  }
  return "http://localhost:3000";
}
