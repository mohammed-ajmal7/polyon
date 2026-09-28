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
      `POLYON_MODEL_PROFILES_JSON must contain valid JSON: ${
        error instanceof Error ? error.message : "invalid JSON"
      }.`,
      { cause: error },
    );
  }

  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > MAX_MODEL_PROFILES) {
    throw new Error(
      `POLYON_MODEL_PROFILES_JSON must contain between 1 and ${MAX_MODEL_PROFILES} profiles.`,
    );
  }

  const profiles = parsed.map((item, index) => parseProfile(item, index));
  const agentIds = new Set<string>();
  const modelsById = new Map<string, ModelProfileConfig>();
  const providersById = new Map<string, ModelProfileConfig>();

  for (const profile of profiles) {
    if (agentIds.has(profile.agentId)) {
      throw new Error(`Duplicate model profile agentId: ${profile.agentId}.`);
    }

    const existingModel = modelsById.get(profile.modelId);
    if (existingModel !== undefined && !sameModelConfiguration(existingModel, profile)) {
      throw new Error(
        `Model profile ${profile.modelId} is configured inconsistently across the roster.`,
      );
    }

    const existingProvider = providersById.get(profile.providerId);
    if (existingProvider !== undefined && !sameProviderConfiguration(existingProvider, profile)) {
      throw new Error(
        `Provider profile ${profile.providerId} is configured inconsistently across the roster.`,
      );
    }

    agentIds.add(profile.agentId);
    modelsById.set(profile.modelId, existingModel ?? profile);
    providersById.set(profile.providerId, existingProvider ?? profile);
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
  environment: Readonly<Record<string, string | undefined>>,
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

  const models = [...profilesByModelId(profiles)].map((profile) => ({
    id: profile.modelId,
    providerId: profile.providerId,
    name: profile.modelName ?? profile.modelId,
    kind: "TEXT" as const,
    capabilityIds: [],
    enabled: true,
  }));

  const providers = [...profilesByProviderId(profiles)].map((profile) => {
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

function profilesByModelId(profiles: readonly ModelProfileConfig[]): ModelProfileConfig[] {
  const seen = new Set<string>();
  return profiles.filter((profile) => {
    if (seen.has(profile.modelId)) return false;
    seen.add(profile.modelId);
    return true;
  });
}

function profilesByProviderId(profiles: readonly ModelProfileConfig[]): ModelProfileConfig[] {
  const seen = new Set<string>();
  return profiles.filter((profile) => {
    if (seen.has(profile.providerId)) return false;
    seen.add(profile.providerId);
    return true;
  });
}

function sameModelConfiguration(a: ModelProfileConfig, b: ModelProfileConfig): boolean {
  return (
    a.modelName === b.modelName &&
    a.providerId === b.providerId
  );
}

function sameProviderConfiguration(a: ModelProfileConfig, b: ModelProfileConfig): boolean {
  return (
    a.providerName === b.providerName &&
    a.endpoint === b.endpoint &&
    a.apiKeyEnv === b.apiKeyEnv
  );
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
    throw new Error(
      `Model profile ${field} at index ${index} exceeds ${MAX_TEXT_LENGTH} characters.`,
    );
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
