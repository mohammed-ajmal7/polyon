import type { ProviderId } from "@polyon/contracts";

import { OpenAICompatibleTextModelAdapter } from "./openai-compatible-text-model-adapter";
import type {
  OpenAICompatibleFetch,
  OpenAICompatibleTextModelAdapterOptions,
} from "./openai-compatible-text-model-adapter";
import type { TextModelProviderAdapter } from "./provider-adapter";

export type BuiltInProviderId = "ollama" | "gemini" | "openai" | "groq" | "openrouter";

export interface BuiltInProviderPreset {
  readonly providerId: BuiltInProviderId;
  readonly providerName: string;
  readonly kind: "LOCAL_MODEL" | "HOSTED_MODEL";
  readonly defaultEndpoint: string;
  readonly defaultApiKeyEnv?: string;
  readonly privacyClass: "local" | "cloud";
  readonly costClass: "free" | "paid";
}

const BUILT_IN_PROVIDER_PRESETS: Readonly<Record<BuiltInProviderId, BuiltInProviderPreset>> = {
  ollama: {
    providerId: "ollama",
    providerName: "Ollama",
    kind: "LOCAL_MODEL",
    defaultEndpoint: "http://127.0.0.1:11434/v1/chat/completions",
    defaultApiKeyEnv: "OLLAMA_API_KEY",
    privacyClass: "local",
    costClass: "free",
  },
  gemini: {
    providerId: "gemini",
    providerName: "Google Gemini",
    kind: "HOSTED_MODEL",
    defaultEndpoint: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    defaultApiKeyEnv: "GEMINI_API_KEY",
    privacyClass: "cloud",
    costClass: "paid",
  },
  openai: {
    providerId: "openai",
    providerName: "OpenAI",
    kind: "HOSTED_MODEL",
    defaultEndpoint: "https://api.openai.com/v1/chat/completions",
    defaultApiKeyEnv: "OPENAI_API_KEY",
    privacyClass: "cloud",
    costClass: "paid",
  },
  groq: {
    providerId: "groq",
    providerName: "Groq",
    kind: "HOSTED_MODEL",
    defaultEndpoint: "https://api.groq.com/openai/v1/chat/completions",
    defaultApiKeyEnv: "GROQ_API_KEY",
    privacyClass: "cloud",
    costClass: "paid",
  },
  openrouter: {
    providerId: "openrouter",
    providerName: "OpenRouter",
    kind: "HOSTED_MODEL",
    defaultEndpoint: "https://openrouter.ai/api/v1/chat/completions",
    defaultApiKeyEnv: "OPENROUTER_API_KEY",
    privacyClass: "cloud",
    costClass: "paid",
  },
};

export interface TextModelProviderFactoryOptions {
  readonly providerId: ProviderId;
  readonly endpoint?: string;
  readonly apiKey?: string;
  readonly fetch?: OpenAICompatibleFetch;
}

export function getBuiltInProviderPreset(
  providerId: ProviderId,
): BuiltInProviderPreset | undefined {
  return isBuiltInProviderId(providerId) ? BUILT_IN_PROVIDER_PRESETS[providerId] : undefined;
}

export function resolveProviderEndpoint(providerId: ProviderId, endpoint?: string): string {
  const explicitEndpoint = endpoint?.trim();

  if (explicitEndpoint !== undefined && explicitEndpoint.length > 0) {
    return explicitEndpoint;
  }

  const preset = getBuiltInProviderPreset(providerId);

  if (preset !== undefined) {
    return preset.defaultEndpoint;
  }

  throw new RangeError(`Provider endpoint is required for provider: ${providerId}.`);
}

export function resolveProviderApiKeyEnv(
  providerId: ProviderId,
  apiKeyEnv?: string,
): string | undefined {
  const explicitApiKeyEnv = apiKeyEnv?.trim();

  if (explicitApiKeyEnv !== undefined && explicitApiKeyEnv.length > 0) {
    return explicitApiKeyEnv;
  }

  return getBuiltInProviderPreset(providerId)?.defaultApiKeyEnv;
}

export function createTextModelProviderAdapter(
  options: TextModelProviderFactoryOptions,
): TextModelProviderAdapter {
  const endpoint = resolveProviderEndpoint(options.providerId, options.endpoint);

  const adapterOptions: OpenAICompatibleTextModelAdapterOptions = {
    providerId: options.providerId,
    endpoint,
    ...(options.apiKey === undefined ? {} : { apiKey: options.apiKey }),
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  };

  return new OpenAICompatibleTextModelAdapter(adapterOptions);
}

function isBuiltInProviderId(providerId: ProviderId): providerId is BuiltInProviderId {
  return (
    providerId === "ollama" ||
    providerId === "gemini" ||
    providerId === "openai" ||
    providerId === "groq" ||
    providerId === "openrouter"
  );
}
