import type { CapabilityId } from "./ids";

export type AiCapabilityId =
  | "ai.chat"
  | "ai.reasoning"
  | "ai.tool-calling"
  | "ai.vision"
  | "ai.audio"
  | "ai.embeddings"
  | "ai.structured-output"
  | "ai.long-context";

export interface AiCapabilityDefinition {
  readonly id: AiCapabilityId;
  readonly name: string;
  readonly description: string;
}

export const AI_CAPABILITY_DEFINITIONS: readonly AiCapabilityDefinition[] = [
  {
    id: "ai.chat",
    name: "Chat",
    description: "Generates and understands conversational text.",
  },
  {
    id: "ai.reasoning",
    name: "Reasoning",
    description: "Performs multi-step reasoning and analysis.",
  },
  {
    id: "ai.tool-calling",
    name: "Tool calling",
    description: "Can select and invoke structured tools through POLYON.",
  },
  {
    id: "ai.vision",
    name: "Vision",
    description: "Understands image and visual inputs.",
  },
  {
    id: "ai.audio",
    name: "Audio",
    description: "Understands or generates audio inputs and outputs.",
  },
  {
    id: "ai.embeddings",
    name: "Embeddings",
    description: "Produces vector embeddings for semantic retrieval.",
  },
  {
    id: "ai.structured-output",
    name: "Structured output",
    description: "Can reliably produce schema-constrained structured responses.",
  },
  {
    id: "ai.long-context",
    name: "Long context",
    description: "Supports large context windows for extended work.",
  },
];

const AI_CAPABILITY_IDS = new Set<CapabilityId>(
  AI_CAPABILITY_DEFINITIONS.map((capability) => capability.id),
);

export function isAiCapabilityId(value: CapabilityId): value is AiCapabilityId {
  return AI_CAPABILITY_IDS.has(value);
}
