import { describe, expect, it } from "vitest";

import type { Policy } from "@polyon/contracts";
import {
  CommandIngressService,
  ExecutionDispatchService,
  MissionCreationService,
  MissionExecutionOrchestrationService,
  MissionExecutionService,
  MissionLifecycleService,
  MissionPlanService,
} from "./index";
import { InMemoryDomainStores } from "@polyon/storage";
import { InMemoryExecutionQueue } from "@polyon/runtime";

const policy: Policy = {
  id: "policy-1",
  name: "Allow low-risk execution",
  description: "Test policy.",
  approvalMode: "AUTO",
  rules: [],
  defaultEffect: "ALLOW",
  enabled: true,
  createdAt: "2026-09-28T00:00:00.000Z",
  updatedAt: "2026-09-28T00:00:00.000Z",
};

describe("MissionExecutionOrchestrationService", () => {
  it("turns an accepted mission command into a queued governed execution", () => {
    const stores = new InMemoryDomainStores();
    const queue = new InMemoryExecutionQueue();

    const commandIngress = new CommandIngressService({
      conversations: stores.conversations,
      messages: stores.messages,
      events: stores.events,
      unitOfWork: stores,
    });

    const command = commandIngress.submit({
      mode: "Mission",
      command: "Build a bounded task.",
      actorId: "user-1",
      conversationId: "conversation-1",
      messageId: "message-1",
      eventId: "event-1",
      participantIds: ["user-1", "agent-1"],
      createdAt: "2026-09-28T00:00:00.000Z",
    });

    const lifecycle = new MissionLifecycleService({
      missions: stores.missions,
      tasks: stores.tasks,
      events: stores.events,
      unitOfWork: stores,
    });
    const plans = new MissionPlanService({
      missions: stores.missions,
      tasks: stores.tasks,
      proposals: stores.missionPlanProposals,
      policyDecisions: stores.policyDecisions,
      approvals: stores.approvals,
      events: stores.events,
      unitOfWork: stores,
    });
    const creation = new MissionCreationService({
      conversations: stores.conversations,
      missions: stores.missions,
      events: stores.events,
      unitOfWork: stores,
    });
    const dispatch = new ExecutionDispatchService({
      queue,
      executions: stores.executions,
      approvals: stores.approvals,
      policyDecisions: stores.policyDecisions,
      events: stores.events,
      unitOfWork: stores,
    });
    const execution = new MissionExecutionService(
      dispatch,
      (task) => stores.tasks.save(task),
      (taskId) => stores.tasks.get(taskId),
      () => stores.executions.list(),
      stores.events,
    );
    const service = new MissionExecutionOrchestrationService(
      creation,
      lifecycle,
      plans,
      execution,
      stores.tasks,
    );

    const result = service.orchestrate({
      command,
      missionId: "mission-1",
      taskIdFactory: (missionId) => missionId + "-task-1",
      proposalId: "proposal-1",
      decisionId: "decision-1",
      approvalRequestId: "approval-1",
      missionCreatedEventId: "event-mission-1",
      planningEventId: "event-planning-1",
      runningEventId: "event-running-1",
      planCreatedAt: "2026-09-28T00:00:01.000Z",
      planningAt: "2026-09-28T00:00:02.000Z",
      taskCreatedAt: "2026-09-28T00:00:03.000Z",
      runningAt: "2026-09-28T00:00:04.000Z",
      actorId: "user-1",
      planningAgentId: "agent-1",
      executionAgentId: "agent-1",
      requiredCapabilityIds: [],
      policy,
      riskLevel: "LOW",
      identities: {
        executionId: (taskId, attempt) => `execution-${taskId}-${attempt}`,
        policyDecisionId: (taskId, executionId) => `decision-${taskId}-${executionId}`,
        approvalRequestId: (taskId, executionId) => `approval-${taskId}-${executionId}`,
      },
    });

    expect(result.status).toBe("QUEUED");
    expect(stores.missions.get("mission-1")?.status).toBe("RUNNING");
    expect(stores.tasks.get("mission-1-task-1")?.status).toBe("APPROVED");
    expect(stores.executions.get("execution-mission-1-task-1-1")?.status).toBe("QUEUED");
    expect(queue.list()).toHaveLength(1);
  });
});
