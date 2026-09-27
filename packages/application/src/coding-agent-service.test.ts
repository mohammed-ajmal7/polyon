import { describe, expect, it, vi } from "vitest";

import { CodingAgentService } from "./coding-agent-service";

describe("CodingAgentService", () => {
  it("exposes only the explicit coding tool profile", async () => {
    const invoke = vi.fn(async (input) => ({
      status: "SUCCEEDED" as const,
      response: { content: "done" },
      rounds: 0,
      requestTools: input.request.tools,
    }));
    const orchestration = {
      modelToolDefinitions: () => [
        { toolId: "filesystem.read.scoped", name: "read", description: "read" },
        { toolId: "terminal.execute.scoped", name: "terminal", description: "terminal" },
        { toolId: "integration.invoke:email-primary:SEND_EMAIL", name: "email", description: "email" },
      ],
      invoke,
    } as never;

    const service = new CodingAgentService(orchestration);

    await service.invoke({
      agentId: "agent-1",
      requiredCapabilityIds: ["coding"],
      request: { messages: [{ role: "USER", content: "fix the bug" }] },
      policy: {
        id: "policy",
        name: "coding",
        description: "coding",
        approvalMode: "BALANCED",
        rules: [],
        defaultEffect: "ALLOW",
        enabled: true,
        createdAt: "2026-09-28T00:00:00.000Z",
        updatedAt: "2026-09-28T00:00:00.000Z",
      },
      actorId: "user-1",
    });

    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({
          tools: [
            expect.objectContaining({ toolId: "filesystem.read.scoped" }),
            expect.objectContaining({ toolId: "terminal.execute.scoped" }),
          ],
        }),
      }),
    );
  });
});
