import type { Tool } from "@polyon/contracts";

import type { ToolAdapterRegistry, ToolRegistry } from "@polyon/tools";

import type { CreativeJobService } from "./creative-job-service";

const CREATIVE_TOOL_ID = "creative.generate";

export function registerCreativeTools(
  tools: ToolRegistry,
  adapters: ToolAdapterRegistry,
  creative: CreativeJobService,
): void {
  const tool: Tool = {
    id: CREATIVE_TOOL_ID,
    name: "Generate creative artifact",
    description: "Runs a configured bounded creative provider and persists its artifact result.",
    kind: "NETWORK",
    actionKinds: ["NETWORK", "WRITE"],
    inputSchema: {
      type: "object",
      required: [
        "id",
        "operation",
        "prompt",
        "outputKind",
        "artifactId",
        "artifactName",
        "location",
      ],
      additionalProperties: false,
      properties: {
        id: { type: "string", minLength: 1, maxLength: 200 },
        operation: {
          type: "string",
          enum: ["IMAGE", "VIDEO", "AUDIO", "VOICE", "EDIT"],
        },
        prompt: { type: "string", minLength: 1, maxLength: 50_000 },
        outputKind: {
          type: "string",
          enum: ["IMAGE", "VIDEO", "AUDIO", "CODE", "DOCUMENT"],
        },
        artifactId: { type: "string", minLength: 1, maxLength: 200 },
        artifactName: { type: "string", minLength: 1, maxLength: 500 },
        location: { type: "string", minLength: 1, maxLength: 4_000 },
        mimeType: { type: "string", maxLength: 200 },
        missionId: { type: "string", maxLength: 200 },
        taskId: { type: "string", maxLength: 200 },
      },
    },
    enabled: true,
  };

  tools.register(tool);
  adapters.register({
    toolId: tool.id,
    async invoke(request) {
      const input = request.input as {
        readonly id: string;
        readonly operation: "IMAGE" | "VIDEO" | "AUDIO" | "VOICE" | "EDIT";
        readonly prompt: string;
        readonly outputKind: "IMAGE" | "VIDEO" | "AUDIO" | "CODE" | "DOCUMENT";
        readonly artifactId: string;
        readonly artifactName: string;
        readonly location: string;
        readonly mimeType?: string;
        readonly missionId?: string;
        readonly taskId?: string;
      };

      const artifact = await creative.run({
        ...input,
        createdAt: new Date().toISOString(),
      });

      return { output: artifact };
    },
  });
}
