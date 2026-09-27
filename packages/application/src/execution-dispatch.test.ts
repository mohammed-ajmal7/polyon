import type { Policy, Task } from "@polyon/contracts";
import type { TaskDependency } from "@polyon/core";
import { describe, expect, it } from "vitest";

import { prepareExecutionDispatch } from "./execution-dispatch";

const task: Task = {
  id: "task-1",
  missionId: "mission-1",
  kind: "CODING",
  title: "Build runtime",
  description: "Implement execution runtime.",
  status: "READY",
  dependsOn: [],
  createdAt: "2026-09-27T01:00:00.000Z",
  updatedAt: "2026-09-27T01:00:00.000Z",
};

const dependencies: readonly TaskDependency[] = [];

const basePolicy: Policy = {
  id: "policy-1",
  name: "Execution policy",
  description: "Controls execution runs.",
  approvalMode: "BALANCED",
  rules: [],
  defaultEffect: "ALLOW",
  enabled: true,
  createdAt: "2026-09-27T00:00:00.000Z",
  updatedAt: "2026-09-27T00:00:00.000Z",
};

const baseInput = {
  task,
  dependencies,
  agentId: "agent-1",
  actorId: "agent-1",
  executionId: "execution-1",
  attempt: 1,
  policy: basePolicy,
  decisionId: "decision-1",
  approvalRequestId: "approval-1",
  requestedBy: "user-1",
  requestedAt: "2026-09-27T01:01:00.000Z",
  evaluatedAt: "2026-09-27T01:02:00.000Z",
  riskLevel: "MEDIUM" as const,
};

describe("prepareExecutionDispatch", () => {
  it("prepares an authorized execution for enqueueing", () => {
    expect(prepareExecutionDispatch(baseInput)).toEqual({
      execution: {
        id: "execution-1",
        missionId: "mission-1",
        agentId: "agent-1",
        taskId: "task-1",
        actorId: "agent-1",
        attempt: 1,
        status: "QUEUED",
        createdAt: "2026-09-27T01:01:00.000Z",
        updatedAt: "2026-09-27T01:02:00.000Z",
      },
      policyDecision: {
        id: "decision-1",
        policyId: "policy-1",
        action: "EXECUTION_RUN",
        riskLevel: "MEDIUM",
        effect: "ALLOW",
        reason: "No policy rule matched; using the policy default effect.",
        evaluatedAt: "2026-09-27T01:02:00.000Z",
      },
      nextStep: "ENQUEUE",
    });
  });

  it("prepares an execution that must wait for approval", () => {
    const result = prepareExecutionDispatch({
      ...baseInput,
      policy: {
        ...basePolicy,
        defaultEffect: "REQUIRE_APPROVAL",
      },
    });

    expect(result.execution.status).toBe("APPROVAL_REQUIRED");
    expect(result.nextStep).toBe("AWAIT_APPROVAL");
    expect(result.approvalRequest).toMatchObject({
      missionId: "mission-1",
      taskId: "task-1",
      executionId: "execution-1",
      action: "EXECUTION_RUN",
      status: "PENDING",
    });
  });

  it("represents policy denial as a rejected execution", () => {
    expect(
      prepareExecutionDispatch({
        ...baseInput,
        policy: {
          ...basePolicy,
          defaultEffect: "DENY",
        },
      }),
    ).toEqual({
      execution: {
        id: "execution-1",
        missionId: "mission-1",
        taskId: "task-1",
        actorId: "agent-1",
        attempt: 1,
        status: "REJECTED",
        createdAt: "2026-09-27T01:01:00.000Z",
        updatedAt: "2026-09-27T01:02:00.000Z",
      },
      policyDecision: {
        id: "decision-1",
        policyId: "policy-1",
        action: "EXECUTION_RUN",
        riskLevel: "MEDIUM",
        effect: "DENY",
        reason: "No policy rule matched; using the policy default effect.",
        evaluatedAt: "2026-09-27T01:02:00.000Z",
      },
      nextStep: "REJECTED",
    });
  });

  it("propagates task readiness failures", () => {
    expect(() =>
      prepareExecutionDispatch({
        ...baseInput,
        task: {
          ...task,
          status: "PENDING",
        },
      }),
    ).toThrow();
  });

  it("does not mutate the task", () => {
    const before = structuredClone(task);

    prepareExecutionDispatch(baseInput);

    expect(task).toEqual(before);
  });
});
