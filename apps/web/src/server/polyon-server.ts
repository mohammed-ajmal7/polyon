import { join } from "node:path";

import type { Agent, Model, Policy, Provider, SecretReference } from "@polyon/contracts";
import { BoundedHttpClient, EnvironmentSecretResolver, SmtpTransport, type EmailTransport } from "@polyon/integrations";
import { OpenAICompatibleTextModelAdapter } from "@polyon/providers";
import { EncryptedFileSecretResolver, NodeSmtpConnectionFactory } from "@polyon/runtime";
import { BoundedWebResearchRetriever, ConfiguredHttpResearchProvider, createPolyonComposition, type PolyonComposition } from "@polyon/application";

const globalState = globalThis as typeof globalThis & { __polyonComposition?: PolyonComposition };

export function getPolyonActorId(): string {
  const actorId = process.env.POLYON_ACTOR_ID?.trim();
  return actorId === undefined || actorId === "" ? "local-user" : actorId;
}

export function getPolyonComposition(): PolyonComposition {
  if (globalState.__polyonComposition !== undefined) return globalState.__polyonComposition;
  const composition = createPolyonComposition(buildOptions());
  if (process.env.POLYON_RUNTIME_AUTOSTART !== "false") composition.runtime.start();
  globalState.__polyonComposition = composition;
  return composition;
}

function buildOptions() {
  const model = buildModelRegistration();
  const email = buildEmailRegistration();
  const secretResolver = email === undefined ? undefined : buildSecretResolver();
  const researchRetriever = buildResearchRetriever();
  return {
    storageRoot: process.env.POLYON_DATA_DIR?.trim() || join(process.cwd(), ".polyon-data"),
    ...(model === undefined ? {} : { agents: [model.agent], models: [model.model], providers: [model.registration] }),
    ...(secretResolver === undefined ? {} : { secretResolver }),
    ...(researchRetriever === undefined ? {} : { researchRetriever }),
    ...(email === undefined ? {} : {
      emailIntegrationId: "email-primary",
      emailSecretReference: email.secretReference,
      emailSmtpUsername: email.username,
      emailTransport: email.transport,
    }),
  };
}

function buildModelRegistration() {
  const endpoint = process.env.POLYON_MODEL_ENDPOINT?.trim();
  const modelId = process.env.POLYON_MODEL_ID?.trim();
  if (endpoint === undefined || endpoint === "" || modelId === undefined || modelId === "") return undefined;
  const providerId = process.env.POLYON_PROVIDER_ID?.trim() || "configured-model-provider";
  const agentId = process.env.POLYON_AGENT_ID?.trim() || "primary";
  const now = new Date().toISOString();
  const provider: Provider = { id: providerId, name: process.env.POLYON_PROVIDER_NAME?.trim() || "Configured model provider", kind: "HOSTED_MODEL", enabled: true };
  const model: Model = { id: modelId, providerId, name: process.env.POLYON_MODEL_NAME?.trim() || modelId, kind: "TEXT", capabilityIds: [], enabled: true };
  const agent: Agent = {
    id: agentId,
    name: process.env.POLYON_AGENT_NAME?.trim() || "Primary",
    role: process.env.POLYON_AGENT_ROLE?.trim() || "General operations",
    description: "Server-configured POLYON agent.",
    status: "ACTIVE",
    capabilityIds: [],
    preferredModelId: modelId,
    fallbackModelIds: [],
    createdAt: now,
    updatedAt: now,
  };
  const adapter = new OpenAICompatibleTextModelAdapter({
    providerId,
    endpoint,
    ...(process.env.POLYON_MODEL_API_KEY === undefined ? {} : { apiKey: process.env.POLYON_MODEL_API_KEY }),
  });
  return { agent, model, registration: { provider, adapter } };
}

function buildEmailRegistration(): { username: string; secretReference: SecretReference; transport: EmailTransport } | undefined {
  const host = process.env.POLYON_SMTP_HOST?.trim();
  const username = process.env.POLYON_SMTP_USERNAME?.trim();
  const port = readInteger(process.env.POLYON_SMTP_PORT, 465);
  if (host === undefined || host === "" || username === undefined || username === "") return undefined;
  const secretReference: SecretReference = { id: "email.primary", kind: "SMTP_CREDENTIAL", provider: "email" };
  const transport = new SmtpTransport({
    host, port,
    secure: readBoolean(process.env.POLYON_SMTP_SECURE, port === 465),
    startTls: readBoolean(process.env.POLYON_SMTP_STARTTLS, port === 587),
    heloName: process.env.POLYON_SMTP_HELO_NAME?.trim() || "polyon.local",
    messageIdDomain: process.env.POLYON_SMTP_MESSAGE_ID_DOMAIN?.trim() || "polyon.local",
  }, new NodeSmtpConnectionFactory());
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

function buildSecretResolver() {
  const masterKeyBase64 = process.env.POLYON_SECRET_MASTER_KEY_BASE64?.trim();
  const storePath = process.env.POLYON_SECRET_STORE_PATH?.trim();
  if (masterKeyBase64 !== undefined && masterKeyBase64 !== "" && storePath !== undefined && storePath !== "") {
    return new EncryptedFileSecretResolver({ filePath: storePath, masterKey: Buffer.from(masterKeyBase64, "base64") });
  }
  return new EnvironmentSecretResolver({
    environment: process.env,
    references: { "email.primary": { provider: "email", kind: "SMTP_CREDENTIAL", environmentVariable: "POLYON_SMTP_PASSWORD" } },
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
  if (!Number.isInteger(parsed)) throw new Error("POLYON integer environment values must be integers.");
  return parsed;
}

export function sanitizeEventData(data: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    const normalized = key.toLowerCase();
    if (normalized.includes("secret") || normalized.includes("password") || normalized.includes("token") || normalized.includes("credential") || normalized.includes("authorization")) continue;
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
