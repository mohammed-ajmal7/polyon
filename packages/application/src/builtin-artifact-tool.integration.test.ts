import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { Policy } from "@polyon/contracts";
import { describe, expect, it } from "vitest";

import { ToolInvocationService } from "./tool-invocation-service";
import {
  BUILTIN_TOOL_IDS,
  createInMemoryBuiltinToolRegistries,
  registerBuiltinTools,
} from "@polyon/tools";
import { InMemoryDomainStores } from "@polyon/storage";

const policy: Policy = {
  id: "artifact-policy",
  name: "Artifact policy",
  description: "Allows artifact writes for the integration test.",
  approvalMode: "BALANCED",
  rules: [],
  defaultEffect: "ALLOW",
  enabled: true,
  createdAt: "2026-09-27T01:00:00.000Z",
  updatedAt: "2026-09-27T01:00:00.000Z",
};

describe("built-in artifact tool integration", () => {
  it("does not duplicate durable metadata when the same artifact is replayed", async () => {
    const root = mkdtempSync(join(tmpdir(), "polyon-artifact-replay-"));

    try {
      const registries = createInMemoryBuiltinToolRegistries();
      const stores = new InMemoryDomainStores();

      registerBuiltinTools(registries, {
        artifactRoot: root,
      });

      const service = new ToolInvocationService({
        tools: registries.tools,
        adapters: registries.adapters,
        approvals: stores.approvals,
        policyDecisions: stores.policyDecisions,
        events: stores.events,
        unitOfWork: stores,
      });

      const base = {
        toolId: BUILTIN_TOOL_IDS.artifactWrite,
        input: {
          name: "replay.txt",
          content: "same artifact",
          kind: "REPORT" as const,
          mimeType: "text/plain",
        },
        action: "WRITE" as const,
        riskLevel: "MEDIUM" as const,
        policy,
        actorId: "agent-1",
        missionId: "mission-1",
        taskId: "task-1",
        executionId: "execution-1",
        agentId: "agent-1",
        requestedBy: "agent-1",
        requestedAt: "2026-09-27T01:01:00.000Z",
        evaluatedAt: "2026-09-27T01:01:00.000Z",
      };

      const first = await service.invoke({
        ...base,
        invocationId: "artifact-replay-1",
        decisionId: "artifact-replay-decision-1",
        approvalRequestId: "artifact-replay-approval-1",
      });

      const second = await service.invoke({
        ...base,
        invocationId: "artifact-replay-2",
        decisionId: "artifact-replay-decision-2",
        approvalRequestId: "artifact-replay-approval-2",
      });

      expect(first.status).toBe("SUCCEEDED");
      expect(second.status).toBe("SUCCEEDED");
      expect(stores.artifacts.list()).toHaveLength(1);
      expect(
        stores.events.list().filter((event) => event.kind === "ARTIFACT_CREATED"),
      ).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("writes and durably registers an artifact through governed invocation", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "polyon-artifact-integration-")));

    try {
      const registries = createInMemoryBuiltinToolRegistries();
      const stores = new InMemoryDomainStores();

      registerBuiltinTools(registries, {
        artifactRoot: root,
      });

      const service = new ToolInvocationService({
        tools: registries.tools,
        adapters: registries.adapters,
        approvals: stores.approvals,
        policyDecisions: stores.policyDecisions,
        events: stores.events,
        unitOfWork: stores,
      });

      const result = await service.invoke({
        invocationId: "artifact-tool-invocation-1",
        toolId: BUILTIN_TOOL_IDS.artifactWrite,
        input: {
          name: "mission-report.txt",
          content: "POLYON mission artifact",
          kind: "REPORT",
          mimeType: "text/plain",
        },
        action: "WRITE",
        riskLevel: "MEDIUM",
        policy,
        decisionId: "artifact-tool-decision-1",
        approvalRequestId: "artifact-tool-approval-1",
        requestedBy: "agent-1",
        requestedAt: "2026-09-27T01:01:00.000Z",
        evaluatedAt: "2026-09-27T01:01:00.000Z",
        actorId: "agent-1",
        missionId: "mission-1",
        taskId: "task-1",
        executionId: "execution-1",
        agentId: "agent-1",
      });

      expect(result.status).toBe("SUCCEEDED");
      expect(readFileSync(join(root, "mission-report.txt"), "utf8")).toBe(
        "POLYON mission artifact",
      );

      const artifacts = stores.artifacts.list();
      expect(artifacts).toHaveLength(1);
      expect(artifacts[0]).toMatchObject({
        kind: "REPORT",
        name: "mission-report.txt",
        mimeType: "text/plain",
        status: "AVAILABLE",
        missionId: "mission-1",
        taskId: "task-1",
        executionId: "execution-1",
      });

      expect(stores.events.get("ARTIFACT_CREATED:" + artifacts[0]!.id)?.data).toMatchObject({
        artifactId: artifacts[0]!.id,
        name: "mission-report.txt",
        kind: "REPORT",
        location: join(root, "mission-report.txt"),
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
