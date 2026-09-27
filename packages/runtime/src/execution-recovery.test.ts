/// <reference path="../../storage/src/node-runtime.d.ts" />

import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { Execution, Task } from "@polyon/contracts";
import { InMemoryExecutionCoordinator } from "./execution-coordinator";
import { InMemoryExecutionQueue } from "./execution-queue";
import { recoverExecutions, recoverQueuedExecutions } from "./execution-recovery";
import { describe, expect, it } from "vitest";

import { FileDomainStores, InMemoryDomainStores } from "@polyon/storage";

const queued = (id: string): Execution => ({
  id,
  missionId: "mission-1",
  taskId: id,
  actorId: "agent-1",
  attempt: 1,
  status: "QUEUED",
  createdAt: "2026-09-27T01:00:00.000Z",
  updatedAt: "2026-09-27T01:00:00.000Z",
});

const approvedTask: Task = {
  id: "task-1",
  missionId: "mission-1",
  kind: "CODING",
  title: "Build runtime",
  description: "Implement runtime.",
  status: "APPROVED",
  dependsOn: [],
  createdAt: "2026-09-27T01:00:00.000Z",
  updatedAt: "2026-09-27T01:00:00.000Z",
};

describe("recoverQueuedExecutions", () => {
  it("restores persisted queued executions that are missing from the queue", () => {
    const stores = new InMemoryDomainStores();
    const queue = new InMemoryExecutionQueue();

    stores.executions.save(queued("execution-1"));
    stores.executions.save({
      ...queued("execution-2"),
      status: "RUNNING",
    });

    expect(recoverQueuedExecutions(stores.executions, queue)).toEqual(["execution-1"]);
    expect(queue.peek()?.id).toBe("execution-1");
  });

  it("requeues an interrupted running execution with an approved resumable tool continuation", () => {
    const stores = new InMemoryDomainStores();
    const queue = new InMemoryExecutionQueue();

    stores.executions.save({
      ...queued("execution-2"),
      status: "RUNNING",
      taskId: "task-2",
    });
    stores.approvals.save({
      id: "approval-2",
      policyId: "policy-1",
      policyDecisionId: "decision-2",
      executionId: "execution-2",
      toolId: "tool-1",
      invocationId: "tool-call:2",
      action: "TERMINAL",
      riskLevel: "MEDIUM",
      requestedBy: "agent-1",
      reason: "Human approval required.",
      status: "APPROVED",
      requestedAt: "2026-09-27T01:00:00.000Z",
      resolvedAt: "2026-09-27T01:01:00.000Z",
      toolContinuation: {
        agentId: "agent-1",
        requiredCapabilityIds: ["text.generate"],
        request: {
          messages: [{ role: "USER", content: "Run the tool." }],
        },
        response: {
          content: "",
          finishReason: "TOOL_CALL",
          toolCalls: [
            {
              id: "2",
              toolId: "tool-1",
              input: {},
            },
          ],
        },
        toolCall: {
          id: "2",
          toolId: "tool-1",
          input: {},
        },
        rounds: 1,
        state: "AWAITING_MODEL",
        toolOutput: "already completed",
        nextRequest: {
          messages: [
            { role: "USER", content: "Run the tool." },
            {
              role: "ASSISTANT",
              content: "",
              toolCalls: [{ id: "2", toolId: "tool-1", input: {} }],
            },
            { role: "TOOL", name: "tool-1", toolCallId: "2", content: "already completed" },
          ],
        },
      },
    });

    expect(
      recoverExecutions(
        stores.executions,
        queue,
        stores.approvals,
        stores.tasks,
        "2026-09-27T01:05:00.000Z",
      ),
    ).toEqual([
      {
        executionId: "execution-2",
        kind: "INTERRUPTED_TOOL_CONTINUATION",
      },
    ]);
    expect(stores.executions.get("execution-2")?.status).toBe("QUEUED");
    expect(queue.peek()?.id).toBe("execution-2");
    expect(stores.executions.get("execution-2")?.updatedAt).toBe("2026-09-27T01:05:00.000Z");
  });

  it("pauses an interrupted execution when a tool approval is still pending", () => {
    const stores = new InMemoryDomainStores();
    const queue = new InMemoryExecutionQueue();

    stores.tasks.save({
      ...approvedTask,
      status: "RUNNING",
    });
    stores.executions.save({
      ...queued("execution-3"),
      status: "RUNNING",
      taskId: "task-1",
    });
    stores.approvals.save({
      id: "approval-3",
      policyId: "policy-1",
      policyDecisionId: "decision-3",
      executionId: "execution-3",
      toolId: "tool-1",
      invocationId: "tool-call:3",
      action: "TERMINAL",
      riskLevel: "MEDIUM",
      requestedBy: "agent-1",
      reason: "Human approval required.",
      status: "PENDING",
      requestedAt: "2026-09-27T01:00:00.000Z",
      toolContinuation: {
        agentId: "agent-1",
        requiredCapabilityIds: ["text.generate"],
        request: {
          messages: [{ role: "USER", content: "Run the tool." }],
        },
        response: {
          content: "",
          finishReason: "TOOL_CALL",
          toolCalls: [
            {
              id: "3",
              toolId: "tool-1",
              input: {},
            },
          ],
        },
        toolCall: {
          id: "3",
          toolId: "tool-1",
          input: {},
        },
        rounds: 1,
        state: "AWAITING_TOOL",
      },
    });

    expect(
      recoverExecutions(
        stores.executions,
        queue,
        stores.approvals,
        stores.tasks,
        "2026-09-27T01:05:00.000Z",
      ),
    ).toEqual([
      {
        executionId: "execution-3",
        kind: "PENDING_TOOL_APPROVAL_RESTART",
      },
    ]);
    expect(stores.executions.get("execution-3")?.status).toBe("PAUSED");
    expect(stores.tasks.get("task-1")?.status).toBe("PAUSED");
    expect(queue.size()).toBe(0);
  });

  it("pauses rather than replays a non-idempotent integration after restart", () => {
    const stores = new InMemoryDomainStores();
    const queue = new InMemoryExecutionQueue();

    stores.tasks.save({
      ...approvedTask,
      status: "RUNNING",
    });
    stores.executions.save({
      ...queued("execution-telegram"),
      status: "RUNNING",
      taskId: "task-1",
    });
    stores.approvals.save({
      id: "approval-telegram",
      policyId: "policy-1",
      policyDecisionId: "decision-telegram",
      executionId: "execution-telegram",
      integrationId: "telegram-primary",
      invocationId: "tool-call:telegram",
      action: "EXTERNAL_COMMUNICATION",
      riskLevel: "MEDIUM",
      requestedBy: "agent-1",
      reason: "Human approval required.",
      status: "APPROVED",
      requestedAt: "2026-09-27T01:00:00.000Z",
      resolvedAt: "2026-09-27T01:01:00.000Z",
      integrationContinuation: {
        agentId: "agent-1",
        requiredCapabilityIds: ["text.generate"],
        request: {
          messages: [{ role: "USER", content: "Send." }],
        },
        response: {
          content: "",
          finishReason: "TOOL_CALL",
          toolCalls: [
            {
              id: "telegram",
              toolId: "integration.invoke:telegram-primary:SEND_MESSAGE",
              input: { chatId: 1, text: "Send." },
            },
          ],
        },
        toolCall: {
          id: "telegram",
          toolId: "integration.invoke:telegram-primary:SEND_MESSAGE",
          input: { chatId: 1, text: "Send." },
        },
        rounds: 1,
        integrationId: "telegram-primary",
        operation: "SEND_MESSAGE",
        input: { chatId: 1, text: "Send." },
        sideEffectClass: "NON_IDEMPOTENT",
        state: "AWAITING_INTEGRATION",
      },
    });

    expect(
      recoverExecutions(
        stores.executions,
        queue,
        stores.approvals,
        stores.tasks,
        "2026-09-27T01:05:00.000Z",
      ),
    ).toEqual([
      {
        executionId: "execution-telegram",
        kind: "NON_IDEMPOTENT_INTEGRATION_RECONCILIATION",
      },
    ]);
    expect(queue.size()).toBe(0);
    expect(stores.executions.get("execution-telegram")?.status).toBe("PAUSED");
    expect(stores.tasks.get("task-1")?.status).toBe("PAUSED");
  });

  it("does not duplicate executions already present in the queue", () => {
    const stores = new InMemoryDomainStores();
    const queue = new InMemoryExecutionQueue();
    const execution = queued("execution-1");

    stores.executions.save(execution);
    queue.enqueue(execution);

    expect(recoverQueuedExecutions(stores.executions, queue)).toEqual([]);
    expect(queue.size()).toBe(1);
  });

  it("recovers a queued execution after a durable-store restart", async () => {
    const directory = mkdtempSync(join(tmpdir(), "polyon-runtime-"));

    try {
      const firstProcessStores = new FileDomainStores(directory);
      firstProcessStores.tasks.save(approvedTask);
      firstProcessStores.executions.save({
        ...queued("execution-1"),
        taskId: "task-1",
      });

      const secondProcessStores = new FileDomainStores(directory);
      const recoveredQueue = new InMemoryExecutionQueue();

      expect(recoveredQueue.size()).toBe(0);
      expect(recoverQueuedExecutions(secondProcessStores.executions, recoveredQueue)).toEqual([
        "execution-1",
      ]);

      const coordinator = new InMemoryExecutionCoordinator({
        queue: recoveredQueue,
        runner: {
          async run(current) {
            expect(current.id).toBe("execution-1");
            expect(current.status).toBe("RUNNING");
            return {
              status: "SUCCEEDED",
              output: "Recovered execution completed.",
            };
          },
        },
        executions: secondProcessStores.executions,
        tasks: secondProcessStores.tasks,
        events: secondProcessStores.events,
      });

      const result = await coordinator.runNextWithResult(
        "2026-09-27T01:05:00.000Z",
        "2026-09-27T01:06:00.000Z",
      );

      expect(result?.execution.status).toBe("SUCCEEDED");
      expect(result?.result.output).toBe("Recovered execution completed.");
      expect(new FileDomainStores(directory).executions.get("execution-1")?.status).toBe(
        "SUCCEEDED",
      );
      expect(recoveredQueue.size()).toBe(0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
