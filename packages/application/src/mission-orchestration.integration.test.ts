import type { Mission, Policy, Task } from "@polyon/contracts";
import {
  CommandIngressService,
  ConversationQueryService,
  ExecutionDispatchService,
  ExecutionResultService,
  MissionCreationService,
  MissionExecutionService,
  MissionLifecycleService,
  MissionPlanService,
} from "@polyon/application";
import { InMemoryExecutionCoordinator, InMemoryExecutionQueue } from "@polyon/runtime";
import { InMemoryDomainStores, InMemoryEventStore } from "@polyon/storage";
import { describe, expect, it } from "vitest";

const policy: Policy = {
  id: "policy-1",
  name: "Allow bounded work",
  description: "Allows low-risk mission planning and execution.",
  approvalMode: "BALANCED",
  rules: [],
  defaultEffect: "ALLOW",
  enabled: true,
  createdAt: "2026-09-27T03:00:00.000Z",
  updatedAt: "2026-09-27T03:00:00.000Z",
};

function createTask(): Task {
  return {
    id: "task-1",
    missionId: "mission-1",
    kind: "CODING",
    title: "Build runtime slice",
    description: "Complete one bounded execution.",
    status: "PENDING",
    dependsOn: [],
    createdAt: "2026-09-27T03:01:00.000Z",
    updatedAt: "2026-09-27T03:01:00.000Z",
  };
}

describe("mission orchestration", () => {
  it("carries one mission from command intake through execution, result publication, and success", async () => {
    const stores = new InMemoryDomainStores();
    const events = new InMemoryEventStore();
    const queue = new InMemoryExecutionQueue();

    const commandIngress = new CommandIngressService({
      conversations: stores.conversations,
      messages: stores.messages,
      events,
    });

    const command = commandIngress.submit({
      mode: "Mission",
      command: "Build the POLYON runtime slice.",
      actorId: "user-1",
      conversationId: "conversation-1",
      messageId: "message-user-1",
      eventId: "event-user-command-1",
      participantIds: ["user-1", "agent-1"],
      createdAt: "2026-09-27T03:02:00.000Z",
    });

    const missionCreation = new MissionCreationService({
      conversations: stores.conversations,
      missions: stores.missions,
      events,
    });

    const created = missionCreation.create({
      id: "mission-1",
      objective: command.message.content,
      actorId: "user-1",
      eventId: "event-mission-created-1",
      conversationId: command.conversation.id,
      createdAt: "2026-09-27T03:03:00.000Z",
    });

    const lifecycle = new MissionLifecycleService({
      missions: stores.missions,
      tasks: stores.tasks,
      events,
    });

    const planning = lifecycle.transition({
      missionId: created.mission.id,
      to: "PLANNING",
      actorId: "user-1",
      eventId: "event-mission-planning-1",
      now: "2026-09-27T03:04:00.000Z",
      causedByEventId: created.event.id,
    });

    const task = createTask();
    stores.tasks.save(task);

    const planService = new MissionPlanService({
      missions: stores.missions,
      tasks: stores.tasks,
      proposals: stores.missionPlanProposals,
      policyDecisions: stores.policyDecisions,
      approvals: stores.approvals,
      events,
    });

    const planned = planService.submit({
      missionId: planning.mission.id,
      proposalId: "proposal-1",
      taskIds: [task.id],
      rationale: "Execute the bounded runtime work.",
      createdBy: "agent-1",
      createdAt: "2026-09-27T03:05:00.000Z",
      policy,
      decisionId: "decision-plan-1",
      approvalRequestId: "approval-plan-1",
      requestedBy: "user-1",
      requestedAt: "2026-09-27T03:05:00.000Z",
      evaluatedAt: "2026-09-27T03:06:00.000Z",
      appliedAt: "2026-09-27T03:07:00.000Z",
      riskLevel: "LOW",
    });

    expect(planned.status).toBe("APPLIED");
    expect(planned.mission.taskIds).toEqual([task.id]);

    const running = lifecycle.transition({
      missionId: "mission-1",
      to: "RUNNING",
      actorId: "user-1",
      eventId: "event-mission-running-1",
      now: "2026-09-27T03:08:00.000Z",
      causedByEventId: planned.events.at(-1)?.id,
    });

    const dispatch = new ExecutionDispatchService({
      queue,
      executions: stores.executions,
      approvals: stores.approvals,
      policyDecisions: stores.policyDecisions,
      events,
    });

    const executionService = new MissionExecutionService(
      dispatch,
      (current) => stores.tasks.save(current),
      (taskId) => stores.tasks.get(taskId),
      () => stores.executions.list(),
      events,
    );

    const identities = {
      executionId: (taskId: string, attempt: number) => `execution-${taskId}-${attempt}`,
      policyDecisionId: (taskId: string, executionId: string) =>
        `decision-${taskId}-${executionId}`,
      approvalRequestId: (taskId: string, executionId: string) =>
        `approval-${taskId}-${executionId}`,
    };

    const dispatched = executionService.dispatchReadyTasks({
      mission: running.mission,
      tasks: [stores.tasks.get(task.id)!],
      actorId: "agent-1",
      agentId: "agent-1",
      policy,
      requestedBy: "user-1",
      now: "2026-09-27T03:09:00.000Z",
      riskLevel: "LOW",
      identities,
    });

    expect(dispatched.dispatched).toHaveLength(1);
    expect(stores.tasks.get(task.id)?.status).toBe("APPROVED");

    const coordinator = new InMemoryExecutionCoordinator({
      queue,
      runner: {
        async run(execution) {
          expect(execution.status).toBe("RUNNING");
          return {
            status: "SUCCEEDED",
            output: "Runtime slice completed.",
          };
        },
      },
      executions: stores.executions,
      tasks: stores.tasks,
      events,
    });

    const completed = await coordinator.runNextWithResult(
      "2026-09-27T03:10:00.000Z",
      "2026-09-27T03:11:00.000Z",
    );

    expect(completed?.execution.status).toBe("SUCCEEDED");

    const resultService = new ExecutionResultService({
      executions: stores.executions,
      conversations: stores.conversations,
      messages: stores.messages,
      artifacts: stores.artifacts,
      events,
    });

    const published = resultService.persist({
      executionId: completed!.execution.id,
      conversationId: "conversation-1",
      messageId: "message-agent-1",
      actorId: "agent-1",
      output: completed!.result.status === "SUCCEEDED" ? completed!.result.output ?? "" : "",
      artifacts: [
        {
          id: "artifact-1",
          kind: "CODE",
          name: "runtime.ts",
          location: "local://workspace/runtime.ts",
          createdAt: "2026-09-27T03:11:00.000Z",
        },
      ],
      createdAt: "2026-09-27T03:11:00.000Z",
    });

    const finalized = lifecycle.syncProgress({
      missionId: "mission-1",
      actorId: "system-1",
      eventId: "event-mission-succeeded-1",
      now: "2026-09-27T03:12:00.000Z",
      causedByEventId: published.events.at(-1)?.id,
    });

    expect(finalized.changed).toBe(true);
    expect(finalized.mission.status).toBe("SUCCEEDED");
    expect(stores.missions.get("mission-1")?.status).toBe("SUCCEEDED");
    expect(stores.artifacts.get("artifact-1")).toMatchObject({
      missionId: "mission-1",
      taskId: "task-1",
      executionId: "execution-task-1-1",
    });

    const snapshot = new ConversationQueryService({
      conversations: stores.conversations,
      messages: stores.messages,
      events,
    }).get("conversation-1");

    expect(snapshot?.messages.map((message) => message.content)).toEqual([
      "Build the POLYON runtime slice.",
      "Runtime slice completed.",
    ]);
    expect(snapshot?.events.map((event) => event.kind)).toEqual([
      "MESSAGE_CREATED",
      "MISSION_CREATED",
      "MESSAGE_CREATED",
      "ARTIFACT_CREATED",
    ]);

    expect(events.listByMission("mission-1").map((event) => event.kind)).toEqual([
      "MISSION_CREATED",
      "MISSION_STATUS_CHANGED",
      "MISSION_PLAN_PROPOSED",
      "POLICY_DECIDED",
      "MISSION_PLAN_APPLIED",
      "MISSION_STATUS_CHANGED",
      "EXECUTION_CREATED",
      "POLICY_DECIDED",
      "EXECUTION_STATUS_CHANGED",
      "TASK_STATUS_CHANGED",
      "TASK_STATUS_CHANGED",
      "EXECUTION_STATUS_CHANGED",
      "EXECUTION_STATUS_CHANGED",
      "TASK_STATUS_CHANGED",
      "MESSAGE_CREATED",
      "ARTIFACT_CREATED",
      "MISSION_STATUS_CHANGED",
    ]);
  });
});
