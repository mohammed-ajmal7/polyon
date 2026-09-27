/// <reference path="../../storage/src/node-runtime.d.ts" />

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Policy } from "@polyon/contracts";
import { InMemoryDomainStores } from "@polyon/storage";
import {
  BUILTIN_TOOL_IDS,
  createInMemoryBuiltinToolRegistries,
  registerBuiltinTools,
} from "@polyon/tools";
import { describe, expect, it } from "vitest";

import { ToolInvocationService } from "./tool-invocation-service";

describe("builtin filesystem tool integration", () => {
  it("executes a real bounded filesystem read through policy and the application service", async () => {
    const root = mkdtempSync(join(tmpdir(), "polyon-tool-integration-"));
    const filePath = join(root, "notes.txt");

    try {
      writeFileSync(filePath, "POLYON governed file read", "utf8");

      const stores = new InMemoryDomainStores();
      const registries = createInMemoryBuiltinToolRegistries();

      registerBuiltinTools(registries, {
        filesystemRoot: root,
      });

      const service = new ToolInvocationService({
        tools: registries.tools,
        adapters: registries.adapters,
        approvals: stores.approvals,
        policyDecisions: stores.policyDecisions,
        events: stores.events,
        unitOfWork: stores,
      });

      const policy: Policy = {
        id: "policy-filesystem-read",
        name: "Allow bounded filesystem reads",
        description: "Allows low-risk reads of the configured local workspace.",
        approvalMode: "AUTO",
        rules: [],
        defaultEffect: "ALLOW",
        enabled: true,
        createdAt: "2026-09-27T04:00:00.000Z",
        updatedAt: "2026-09-27T04:00:00.000Z",
      };

      const result = await service.invoke({
        invocationId: "invocation-filesystem-read-1",
        toolId: BUILTIN_TOOL_IDS.filesystemRead,
        input: { path: "notes.txt", maxBytes: 1024 },
        action: "READ",
        riskLevel: "LOW",
        policy,
        decisionId: "decision-filesystem-read-1",
        approvalRequestId: "approval-filesystem-read-1",
        requestedBy: "user-1",
        requestedAt: "2026-09-27T04:01:00.000Z",
        evaluatedAt: "2026-09-27T04:01:00.000Z",
        actorId: "agent-1",
        missionId: "mission-1",
        taskId: "task-1",
        executionId: "execution-filesystem-read-1",
        agentId: "agent-1",
      });

      expect(result).toMatchObject({
        status: "SUCCEEDED",
        invocationId: "invocation-filesystem-read-1",
        toolId: BUILTIN_TOOL_IDS.filesystemRead,
        output: {
          path: "notes.txt",
          content: "POLYON governed file read",
          sizeBytes: 25,
        },
      });

      expect(stores.policyDecisions.get("decision-filesystem-read-1")).toMatchObject({
        effect: "ALLOW",
        action: "READ",
        riskLevel: "LOW",
      });

      expect(
        stores.events.listByExecution("execution-filesystem-read-1").map((event) => event.kind),
      ).toEqual(["POLICY_DECIDED", "TOOL_INVOKED", "TOOL_INVOKED"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
