import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { Artifact, Policy } from "@polyon/contracts";
import {
  BUILTIN_TOOL_IDS,
  createInMemoryBuiltinToolRegistries,
  registerBuiltinTools,
} from "@polyon/tools";
import { InMemoryDomainStores } from "@polyon/storage";
import { describe, expect, it } from "vitest";

import { ArtifactCatalogService, LocalArtifactContentService } from "./index";
import { ToolInvocationService } from "./tool-invocation-service";

const policy: Policy = {
  id: "artifact-read-policy",
  name: "Artifact read policy",
  description: "Allows agent artifact reads.",
  approvalMode: "BALANCED",
  rules: [],
  defaultEffect: "ALLOW",
  enabled: true,
  createdAt: "2026-09-27T01:00:00.000Z",
  updatedAt: "2026-09-27T01:00:00.000Z",
};

describe("governed artifact access integration", () => {
  it("lists and reads a durable artifact through the governed tool boundary", async () => {
    const root = mkdtempSync(join(tmpdir(), "polyon-artifact-access-"));

    try {
      const file = join(root, "report.txt");
      writeFileSync(file, "POLYON artifact");

      const artifact: Artifact = {
        id: "artifact-1",
        kind: "REPORT",
        name: "report.txt",
        location: file,
        status: "AVAILABLE",
        missionId: "mission-1",
        taskId: "task-1",
        executionId: "execution-1",
        createdAt: "2026-09-27T01:00:00.000Z",
        updatedAt: "2026-09-27T01:00:00.000Z",
      };

      const stores = new InMemoryDomainStores();
      stores.artifacts.save(artifact);

      const catalog = new ArtifactCatalogService({
        artifacts: stores.artifacts,
      });
      const content = new LocalArtifactContentService({
        artifacts: stores.artifacts,
        options: { rootDir: root },
      });

      const registries = createInMemoryBuiltinToolRegistries();
      registerBuiltinTools(registries, {
        artifactList: (filter) => catalog.list(filter),
        artifactRead: (artifactId, maxBytes) => content.read(artifactId, maxBytes),
      });

      const service = new ToolInvocationService({
        tools: registries.tools,
        adapters: registries.adapters,
        approvals: stores.approvals,
        policyDecisions: stores.policyDecisions,
        events: stores.events,
        unitOfWork: stores,
      });

      const listResult = await service.invoke({
        invocationId: "artifact-list-1",
        toolId: BUILTIN_TOOL_IDS.artifactList,
        input: { missionId: "mission-1" },
        action: "READ",
        riskLevel: "LOW",
        policy,
        decisionId: "artifact-list-decision",
        approvalRequestId: "artifact-list-approval",
        requestedBy: "agent-1",
        requestedAt: "2026-09-27T01:01:00.000Z",
        evaluatedAt: "2026-09-27T01:01:00.000Z",
        actorId: "agent-1",
        missionId: "mission-1",
        taskId: "task-1",
        executionId: "execution-1",
        agentId: "agent-1",
      });

      expect(listResult.status).toBe("SUCCEEDED");
      if (listResult.status !== "SUCCEEDED") {
        throw new Error("Artifact list invocation did not succeed.");
      }
      expect(listResult.output).toMatchObject({
        artifacts: [{ id: "artifact-1", name: "report.txt" }],
      });

      const readResult = await service.invoke({
        invocationId: "artifact-read-1",
        toolId: BUILTIN_TOOL_IDS.artifactRead,
        input: { artifactId: "artifact-1", maxBytes: 64 },
        action: "READ",
        riskLevel: "LOW",
        policy,
        decisionId: "artifact-read-decision",
        approvalRequestId: "artifact-read-approval",
        requestedBy: "agent-1",
        requestedAt: "2026-09-27T01:02:00.000Z",
        evaluatedAt: "2026-09-27T01:02:00.000Z",
        actorId: "agent-1",
        missionId: "mission-1",
        taskId: "task-1",
        executionId: "execution-2",
        agentId: "agent-1",
      });

      expect(readResult.status).toBe("SUCCEEDED");
      if (readResult.status !== "SUCCEEDED") {
        throw new Error("Artifact read invocation did not succeed.");
      }
      expect(readResult.output).toMatchObject({
        artifact: { id: "artifact-1" },
        content: "POLYON artifact",
        sizeBytes: 15,
      });
      expect(stores.events.get("TOOL_INVOKED:artifact-read-1:SUCCEEDED")).toBeDefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
