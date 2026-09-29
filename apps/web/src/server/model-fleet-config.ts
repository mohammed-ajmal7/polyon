import type {
  Agent,
  Model,
  Provider,
  BuiltInAgentRoleId,
  ModelCostClass,
  ModelPrivacyClass,
} from "@polyon/contracts";
import { getBuiltInAgentRole } from "@polyon/contracts";
import {
  createTextModelProviderAdapter,
  getBuiltInProviderPreset,
  resolveProviderApiKeyEnv,
  resolveProviderEndpoint,
} from "@polyon/providers";
import type { PolyonProviderRegistration } from "@polyon/application";

export interface ModelProfileConfig {
  readonly agentId: string;
  readonly agentName?: string;
  readonly agentRole?: string;
  readonly agentRoleId?: BuiltInAgentRoleId;
  readonly agentDescription?: string;
  readonly agentCapabilityIds?: readonly string[];
  readonly modelId: string;
  readonly modelName?: string;
  readonly providerId: string;
  readonly providerName?: string;
  readonly endpoint?: string;
  readonly apiKeyEnv?: string;
  readonly fallbackModelIds?: readonly string[];
  readonly capabilityIds?: readonly string[];
  readonly modelCapabilityIds?: readonly string[];
  readonly contextWindow?: number;
  readonly supportsTools?: boolean;
  readonly supportsVision?: boolean;
  readonly privacyClass?: ModelPrivacyClass;
  readonly costClass?: ModelCostClass;
}

export interface ModelRegistrationBundle {
  readonly agents: Agent[];
  readonly models: Model[];
  readonly providers: PolyonProviderRegistration[];
}

const MAX_MODEL_PROFILES = 12;
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
      if (!modelsById.has(fallbackId)) {
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

  const agents = profiles.map((profile) => {
    const roleDefinition =
      profile.agentRoleId === undefined ? undefined : getBuiltInAgentRole(profile.agentRoleId);
    const fallbackRoleCapabilities = roleDefinition?.defaultCapabilityIds ?? [];
    const agentCapabilityIds =
      profile.agentCapabilityIds ?? profile.capabilityIds ?? fallbackRoleCapabilities;

    return {
      id: profile.agentId,
      name: profile.agentName ?? roleDefinition?.name ?? profile.agentId,
      role: profile.agentRole ?? roleDefinition?.name ?? "General operations",
      ...(profile.agentRoleId === undefined ? {} : { roleId: profile.agentRoleId }),
      description:
        profile.agentDescription ??
        roleDefinition?.description ??
        "Server-configured POLYON agent.",
      status: "ACTIVE" as const,
      capabilityIds: [...new Set(agentCapabilityIds)],
      preferredModelId: profile.modelId,
      fallbackModelIds: [...(profile.fallbackModelIds ?? [])],
      createdAt: now,
      updatedAt: now,
    };
  });

  const models = [...profilesByModelId(profiles)].map((profile) => {
    const configuredCapabilities = profile.modelCapabilityIds ?? ["ai.chat"];
    const capabilityIds = new Set(configuredCapabilities);

    if (profile.supportsTools === true) capabilityIds.add("ai.tool-calling");
    if (profile.supportsVision === true) capabilityIds.add("ai.vision");

    return {
      id: profile.modelId,
      providerId: profile.providerId,
      name: profile.modelName ?? profile.modelId,
      kind: "TEXT" as const,
      capabilityIds: [...capabilityIds],
      ...(profile.contextWindow === undefined ? {} : { contextWindow: profile.contextWindow }),
      ...(profile.supportsTools === undefined ? {} : { supportsTools: profile.supportsTools }),
      ...(profile.supportsVision === undefined ? {} : { supportsVision: profile.supportsVision }),
      ...(profile.privacyClass === undefined ? {} : { privacyClass: profile.privacyClass }),
      ...(profile.costClass === undefined ? {} : { costClass: profile.costClass }),
      enabled: true,
    };
  });

  const providers = [...profilesByProviderId(profiles)].map((profile) => {
    const endpoint = resolveProviderEndpoint(profile.providerId, profile.endpoint);
    const apiKeyEnv = resolveProviderApiKeyEnv(profile.providerId, profile.apiKeyEnv);
    const apiKey = apiKeyEnv === undefined ? undefined : environment[apiKeyEnv]?.trim();
    const preset = getBuiltInProviderPreset(profile.providerId);
    const provider: Provider = {
      id: profile.providerId,
      name: profile.providerName ?? preset?.providerName ?? profile.providerId,
      kind: preset?.kind ?? "HOSTED_MODEL",
      enabled: true,
    };
    const adapter = createTextModelProviderAdapter({
      providerId: profile.providerId,
      endpoint,
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
    a.providerId === b.providerId &&
    JSON.stringify(a.modelCapabilityIds ?? a.capabilityIds ?? ["ai.chat"]) ===
      JSON.stringify(b.modelCapabilityIds ?? b.capabilityIds ?? ["ai.chat"]) &&
    a.contextWindow === b.contextWindow &&
    a.supportsTools === b.supportsTools &&
    a.supportsVision === b.supportsVision &&
    a.privacyClass === b.privacyClass &&
    a.costClass === b.costClass
  );
}

function sameProviderConfiguration(a: ModelProfileConfig, b: ModelProfileConfig): boolean {
  return (
    a.providerName === b.providerName &&
    resolveProviderEndpoint(a.providerId, a.endpoint) ===
      resolveProviderEndpoint(b.providerId, b.endpoint) &&
    resolveProviderApiKeyEnv(a.providerId, a.apiKeyEnv) ===
      resolveProviderApiKeyEnv(b.providerId, b.apiKeyEnv)
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
    agentRoleId: parseRoleId(record.agentRoleId, index),
    agentDescription: optionalString(record.agentDescription, "agentDescription", index),
    agentCapabilityIds: parseStringList(record.agentCapabilityIds, "agentCapabilityIds", index),
    modelId: requiredString(record.modelId, "modelId", index),
    modelName: optionalString(record.modelName, "modelName", index),
    providerId: requiredString(record.providerId, "providerId", index),
    providerName: optionalString(record.providerName, "providerName", index),
    endpoint: optionalString(record.endpoint, "endpoint", index),
    apiKeyEnv: optionalString(record.apiKeyEnv, "apiKeyEnv", index),
    fallbackModelIds: parseFallbacks(record.fallbackModelIds, index),
    capabilityIds: parseStringList(record.capabilityIds, "capabilityIds", index),
    modelCapabilityIds: parseStringList(record.modelCapabilityIds, "modelCapabilityIds", index),
    contextWindow: parseOptionalPositiveInteger(record.contextWindow, "contextWindow", index),
    supportsTools: parseOptionalBoolean(record.supportsTools, "supportsTools", index),
    supportsVision: parseOptionalBoolean(record.supportsVision, "supportsVision", index),
    privacyClass: parsePrivacyClass(record.privacyClass, index),
    costClass: parseCostClass(record.costClass, index),
  };
}


function parseRoleId(value: unknown, index: number): BuiltInAgentRoleId | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || getBuiltInAgentRole(value as BuiltInAgentRoleId) === undefined) {
    throw new Error(
      `Model profile agentRoleId at index ${index} must be a supported built-in role.`,
    );
  }
  return value as BuiltInAgentRoleId;
}

function parseStringList(
  value: unknown,
  field: string,
  index: number,
): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 16) {
    throw new Error(
      `Model profile ${field} at index ${index} must contain at most 16 values.`,
    );
  }

  const values = value.map((item) => requiredString(item, field + " item", index));
  return [...new Set(values)];
}

function parseOptionalPositiveInteger(
  value: unknown,
  field: string,
  index: number,
): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new Error(
      `Model profile ${field} at index ${index} must be a positive integer.`,
    );
  }
  return value as number;
}

function parseOptionalBoolean(
  value: unknown,
  field: string,
  index: number,
): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw new Error(`Model profile ${field} at index ${index} must be a boolean.`);
  }
  return value;
}

function parsePrivacyClass(
  value: unknown,
  index: number,
): ModelPrivacyClass | undefined {
  if (value === undefined) return undefined;
  if (value !== "local" && value !== "cloud") {
    throw new Error(
      `Model profile privacyClass at index ${index} must be local or cloud.`,
    );
  }
  return value;
}

function parseCostClass(value: unknown, index: number): ModelCostClass | undefined {
  if (value === undefined) return undefined;
  if (value !== "free" && value !== "paid") {
    throw new Error(
      `Model profile costClass at index ${index} must be free or paid.`,
    );
  }
  return value;
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
