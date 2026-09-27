import type { ToolId } from "@polyon/contracts";

import type { ToolAdapter } from "./tool-adapter";

export type ToolAdapterRegistryErrorKind = "TOOL_ADAPTER_ALREADY_EXISTS";

export class ToolAdapterRegistryError extends Error {
  readonly kind: ToolAdapterRegistryErrorKind;
  readonly toolId: ToolId;

  constructor(kind: ToolAdapterRegistryErrorKind, toolId: ToolId) {
    super(`Tool adapter already exists in registry: ${toolId}.`);
    this.name = "ToolAdapterRegistryError";
    this.kind = kind;
    this.toolId = toolId;
  }
}

export interface ToolAdapterRegistry {
  register(adapter: ToolAdapter): void;
  get(toolId: ToolId): ToolAdapter | undefined;
  list(): readonly ToolAdapter[];
}

export class InMemoryToolAdapterRegistry implements ToolAdapterRegistry {
  private readonly adapters = new Map<ToolId, ToolAdapter>();

  register(adapter: ToolAdapter): void {
    if (this.adapters.has(adapter.toolId)) {
      throw new ToolAdapterRegistryError("TOOL_ADAPTER_ALREADY_EXISTS", adapter.toolId);
    }

    this.adapters.set(adapter.toolId, adapter);
  }

  get(toolId: ToolId): ToolAdapter | undefined {
    return this.adapters.get(toolId);
  }

  list(): readonly ToolAdapter[] {
    return [...this.adapters.values()];
  }
}
