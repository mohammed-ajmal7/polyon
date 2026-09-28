import type { Evidence, MemoryEntry, MemoryScope, Source, Tool } from "@polyon/contracts";
import type { ToolAdapter, ToolAdapterRegistry, ToolRegistry } from "@polyon/tools";

import type { MemoryService } from "./memory-service";
import type { ResearchService } from "./research-service";

const MEMORY_TOOL_ID = "memory.search.scoped";
const MEMORY_WRITE_TOOL_ID = "memory.remember";
const RESEARCH_TOOL_ID = "research.search.bounded";

interface MemorySearchInput {
  readonly query: string;
  readonly scope?: MemoryScope;
  readonly missionId?: string;
  readonly taskId?: string;
  readonly tags?: readonly string[];
  readonly limit?: number;
}

interface ResearchSearchInput {
  readonly query: string;
  readonly sourceLimit?: number;
}

interface MemorySearchOutput {
  readonly items: readonly MemoryEntry[];
}

interface ResearchSearchOutput {
  readonly sources: readonly Source[];
  readonly evidence: readonly Evidence[];
}

export function registerKnowledgeTools(
  tools: ToolRegistry,
  adapters: ToolAdapterRegistry,
  memory: MemoryService,
  research?: ResearchService,
): void {
  const memoryTool: Tool = {
    id: MEMORY_TOOL_ID,
    name: "Scoped memory search",
    description: "Searches durable POLYON memory within explicit scope filters.",
    kind: "OTHER",
    actionKinds: ["READ"],
    inputSchema: {
      type: "object",
      required: ["query"],
      additionalProperties: false,
      properties: {
        query: { type: "string", minLength: 1, maxLength: 5000 },
        scope: { type: "string", enum: ["PRIVATE", "PROJECT", "MISSION", "TASK"] },
        missionId: { type: "string", minLength: 1, maxLength: 200 },
        taskId: { type: "string", minLength: 1, maxLength: 200 },
        tags: {
          type: "array",
          maxItems: 32,
          items: { type: "string", minLength: 1, maxLength: 100 },
        },
        limit: { type: "integer", minimum: 1, maximum: 100 },
      },
    },
    enabled: true,
  };

  const rememberTool: Tool = {
    id: MEMORY_WRITE_TOOL_ID,
    name: "Remember durable memory",
    description: "Persists an explicitly requested memory entry in a bounded scope.",
    kind: "OTHER",
    actionKinds: ["WRITE"],
    inputSchema: {
      type: "object",
      required: ["id", "kind", "scope", "text"],
      additionalProperties: false,
      properties: {
        id: { type: "string", minLength: 1, maxLength: 200 },
        kind: { type: "string", enum: ["FACT", "PREFERENCE", "DECISION", "SUMMARY", "OTHER"] },
        scope: { type: "string", enum: ["PRIVATE", "PROJECT", "MISSION", "TASK"] },
        text: { type: "string", minLength: 1, maxLength: 50_000 },
        tags: {
          type: "array",
          maxItems: 32,
          items: { type: "string", minLength: 1, maxLength: 100 },
        },
        sourceIds: {
          type: "array",
          maxItems: 100,
          items: { type: "string", minLength: 1, maxLength: 200 },
        },
        missionId: { type: "string", maxLength: 200 },
        taskId: { type: "string", maxLength: 200 },
      },
    },
    enabled: true,
  };

  tools.register(rememberTool);
  adapters.register({
    toolId: rememberTool.id,
    async invoke(request) {
      const input = request.input as {
        readonly id: string;
        readonly kind: "FACT" | "PREFERENCE" | "DECISION" | "SUMMARY" | "OTHER";
        readonly scope: "PRIVATE" | "PROJECT" | "MISSION" | "TASK";
        readonly text: string;
        readonly tags?: readonly string[];
        readonly sourceIds?: readonly string[];
        readonly missionId?: string;
        readonly taskId?: string;
      };
      return {
        output: memory.remember({
          ...input,
          now: new Date().toISOString(),
        }),
      };
    },
  });

  tools.register(memoryTool);
  adapters.register({
    toolId: memoryTool.id,
    async invoke(request) {
      return {
        output: {
          items: memory.search(request.input as MemorySearchInput),
        } satisfies MemorySearchOutput,
      };
    },
  });

  if (research === undefined) return;

  const researchTool: Tool = {
    id: RESEARCH_TOOL_ID,
    name: "Bounded research search",
    description: "Retrieves a bounded set of web sources and persists their evidence.",
    kind: "NETWORK",
    actionKinds: ["NETWORK"],
    inputSchema: {
      type: "object",
      required: ["query"],
      additionalProperties: false,
      properties: {
        query: { type: "string", minLength: 1, maxLength: 5000 },
        sourceLimit: { type: "integer", minimum: 1, maximum: 20 },
      },
    },
    enabled: true,
  };

  tools.register(researchTool);
  adapters.register({
    toolId: researchTool.id,
    async invoke(request) {
      const input = request.input as ResearchSearchInput;
      const result = await research.conduct({
        query: input.query,
        sourceLimit: input.sourceLimit,
        actorId: request.context?.actorId,
        missionId: request.context?.missionId,
        taskId: request.context?.taskId,
        sourceIdFactory: (index, candidate) =>
          "research-source-" +
          stableId(index + ":" + candidate.locator + ":" + candidate.retrievedAt),
        evidenceIdFactory: (index, candidate) =>
          "research-evidence-" +
          stableId(index + ":" + candidate.locator + ":" + candidate.retrievedAt),
        now: new Date().toISOString(),
      });

      return {
        output: {
          sources: result.sources,
          evidence: result.evidence,
        } satisfies ResearchSearchOutput,
      };
    },
  });
}

function stableId(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
