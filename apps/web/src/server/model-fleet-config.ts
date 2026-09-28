import type { Agent, Model, Provider } from "@polyon/contracts";
import { OpenAICompatibleTextModelAdapter } from "@polyon/providers";
import type { PolyonProviderRegistration } from "@polyon/application";

export interface ModelProfileConfig {
  readonly agentId: string;
  readonly agentName?: string;
  readonly agentRole?: string;
  readonly agentDescription?: string;
  readonly modelId: string;
  readonly modelName?: string;
  readonly providerId: string;
  readonly providerName?: string;
  readonly endpoint: string;
  readonly apiKeyEnv?: string;
  readonly fallbackModelIds?: readonly string[];
}

export interface ModelRegistrationBundle {
  readonly agents: Agent[];
  readonly models: Model[];
  readonly providers: PolyonProviderRegistration[];
}

const MAX_MODEL_PROFILES = 8;
const MAX_TEXT_LENGTH = 200;

export function parseModelProfiles(value: string): ModelProfileConfig[] {
  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error(
      `POLYON_MODEL_PROFILES_JSON must contain valid JSON: ${error instanceof Error ? error.message : "invalid JSON"}.`,
    );
  }

  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > MAX_MODEL_PROFILES) {
    throw new Error(
      `POLYON_MODEL_PROFILES_JSON must contain between 1 and ${MAX_MODEL_PROFILES} profiles.`,
    );
  }

  const profiles = parsed.map((item, index) => parseProfile(item, index));
  const agentIds = new Set<string>();
  const modelIds = new Set<string>();
  const providerIds = new Set<string>();

  for (const profile of profiles) {
    if (agentIds.has(profile.agentId)) {
      throw new Error(`Duplicate model profile agentId: ${profile.agentId}.`);
    }
    if (modelIds.has(profile.modelId)) {
      throw new Error(`Duplicate model profile modelId: ${profile.modelId}.`);
    }
    if (providerIds.has(profile.providerId)) {
      throw new Error(
        `Duplicate model profile providerId: ${profile.providerId}. Each configured provider must have one endpoint.`,
      );
    }
    agentIds.add(profile.agentId);
    modelIds.add(profile.modelId);
    providerIds.add(profile.providerId);
  }

  for (const profile of profiles) {
    for (const fallbackId of profile.fallbackModelIds ?? []) {
      if (!modelIds.has(fallbackId)) {
        throw new Error(
          `Model profile ${profile.agentId} references an unknown fallback model: ${fallbackId}.`,
        );
      }
    }
  }

  return profiles;
}

export function buildModelRegistrations(
  profiles: readonly ModelProfileConfig[],
  environment: NodeJS.ProcessEnv,
): ModelRegistrationBundle {
  const now = new Date().toISOString();

  const agents = profiles.map((profile) => ({
    id: profile.agentId,
    name: profile.agentName ?? profile.agentId,
    role: profile.agentRole ?? "General operations",
    description: profile.agentDescription ?? "Server-configured POLYON agent.",
    status: "ACTIVE" as const,
    capabilityIds: [],
    preferredModelId: profile.modelId,
    fallbackModelIds: [...(profile.fallbackModelIds ?? [])],
    createdAt: now,
    updatedAt: now,
  }));

  const models = profiles.map((profile) => ({
    id: profile.modelId,
    providerId: profile.providerId,
    name: profile.modelName ?? profile.modelId,
    kind: "TEXT" as const,
    capabilityIds: [],
    enabled: true,
  }));

  const providers = profiles.map((profile) => {
    const apiKey =
      profile.apiKeyEnv === undefined ? undefined : environment[profile.apiKeyEnv]?.trim();
    const provider: Provider = {
      id: profile.providerId,
      name: profile.providerName ?? profile.providerId,
      kind: "HOSTED_MODEL",
      enabled: true,
    };
    const adapter = new OpenAICompatibleTextModelAdapter({
      providerId: profile.providerId,
      endpoint: profile.endpoint,
      ...(apiKey === undefined || apiKey === "" ? {} : { apiKey }),
    });

    return { provider, adapter } satisfies PolyonProviderRegistration;
  });

  return { agents, models, providers };
}

function parseProfile(value: unknown, index: number): ModelProfileConfig {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Model profile at index ${index} must be an object.`);
  }

  const record = value as Record<string, unknown>;

  return {
    agentId: requiredString(record.agentId, "agentId", index),
    agentName: optionalString(record.agentName, "agentName", index),
    agentRole: optionalString(record.agentRole, "agentRole", index),
    agentDescription: optionalString(record.agentDescription, "agentDescription", index),
    modelId: requiredString(record.modelId, "modelId", index),
    modelName: optionalString(record.modelName, "modelName", index),
    providerId: requiredString(record.providerId, "providerId", index),
    providerName: optionalString(record.providerName, "providerName", index),
    endpoint: requiredString(record.endpoint, "endpoint", index),
    apiKeyEnv: optionalString(record.apiKeyEnv, "apiKeyEnv", index),
    fallbackModelIds: parseFallbacks(record.fallbackModelIds, index),
  };
}

function requiredString(value: unknown, field: string, index: number): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Model profile at index ${index} requires a non-empty ${field}.`);
  }

  const trimmed = value.trim();
  if (trimmed.length > MAX_TEXT_LENGTH) {
    throw new Error(`Model profile ${field} at index ${index} exceeds ${MAX_TEXT_LENGTH} characters.`);
  }

  return trimmed;
}

function optionalString(value: unknown, field: string, index: number): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, field, index);
}

function parseFallbacks(value: unknown, index: number): readonly string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_MODEL_PROFILES) {
    throw new Error(
      `Model profile fallbackModelIds at index ${index} must contain at most ${MAX_MODEL_PROFILES} models.`,
    );
  }

  return value.map((item) => requiredString(item, "fallbackModelId", index));
}
