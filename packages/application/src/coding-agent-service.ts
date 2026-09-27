import type {
  ModelToolDefinition,
  TextModelRequest,
  ToolId,
} from "@polyon/contracts";

import type { AgentToolOrchestrationResult } from "./agent-tool-orchestration-service";
import type { AgentToolOrchestrationService } from "./agent-tool-orchestration-service";

export const DEFAULT_CODING_TOOL_IDS: readonly ToolId[] = [
  "filesystem.read.scoped",
  "terminal.execute.scoped",
  "git.read.scoped",
  "git.write.scoped",
  "git.commit.scoped",
  "artifact.write.scoped",
  "artifact.list.scoped",
  "artifact.read.scoped",
];

export interface CodingAgentInput {
  readonly agentId: string;
  readonly requiredCapabilityIds: readonly string[];
  readonly request: TextModelRequest;
  readonly policy: import("@polyon/contracts").Policy;
  readonly actorId: string;
  readonly missionId?: string;
  readonly taskId?: string;
  readonly executionId?: string;
  readonly maxToolRounds?: number;
  readonly maxToolOutputBytes?: number;
  readonly allowedToolIds?: readonly ToolId[];
}

export class CodingAgentService {
  constructor(private readonly orchestration: AgentToolOrchestrationService) {}

  invoke(input: CodingAgentInput): Promise<AgentToolOrchestrationResult> {
    const allowed = new Set(input.allowedToolIds ?? DEFAULT_CODING_TOOL_IDS);
    const all = this.orchestration.modelToolDefinitions();
    const exposed: readonly ModelToolDefinition[] = all.filter((tool) => allowed.has(tool.toolId as ToolId));

    if (exposed.length === 0) {
      throw new Error("Coding agent has no enabled tools in its explicit allowlist.");
    }

    return this.orchestration.invoke({
      ...input,
      request: {
        ...input.request,
        tools: exposed,
      },
    });
  }
}
