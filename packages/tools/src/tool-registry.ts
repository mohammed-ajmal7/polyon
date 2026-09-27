import type { Tool, ToolId } from "@polyon/contracts";

export type ToolRegistryErrorKind = "TOOL_ALREADY_EXISTS";

export class ToolRegistryError extends Error {
  readonly kind: ToolRegistryErrorKind;
  readonly toolId: ToolId;

  constructor(kind: ToolRegistryErrorKind, toolId: ToolId) {
    super(`Tool already exists in registry: ${toolId}.`);
    this.name = "ToolRegistryError";
    this.kind = kind;
    this.toolId = toolId;
  }
}

export interface ToolRegistry {
  register(tool: Tool): void;
  get(toolId: ToolId): Tool | undefined;
  list(): readonly Tool[];
}

function cloneTool(tool: Tool): Tool {
  return {
    ...tool,
    actionKinds: [...tool.actionKinds],
  };
}

export class InMemoryToolRegistry implements ToolRegistry {
  private readonly tools = new Map<ToolId, Tool>();

  register(tool: Tool): void {
    if (this.tools.has(tool.id)) {
      throw new ToolRegistryError("TOOL_ALREADY_EXISTS", tool.id);
    }

    this.tools.set(tool.id, cloneTool(tool));
  }

  get(toolId: ToolId): Tool | undefined {
    const tool = this.tools.get(toolId);

    return tool === undefined ? undefined : cloneTool(tool);
  }

  list(): readonly Tool[] {
    return [...this.tools.values()].map(cloneTool);
  }
}
