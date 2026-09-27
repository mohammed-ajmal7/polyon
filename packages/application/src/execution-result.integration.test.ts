import type { Conversation, Execution, Task } from "@polyon/contracts";
import { InMemoryExecutionCoordinator, InMemoryExecutionQueue } from "@polyon/runtime";
import { InMemoryDomainStores, InMemoryEventStore } from "@polyon/storage";
import { describe, expect, it } from "vitest";

import {
  ExecutionResultService,
  type PersistExecutionResultInput,
} from "./execution-result-service";

const execution: Execution = {
  id: "execution-1",
  missionId: "mission-1",
  taskId: "task-1",
  actorId: "agent-1",
  attempt: 1,
  status: "QUEUED",
  createdAt: "2026-09-27T03:00:00.000Z",
  updatedAt: "2026-09-27T03:00:00.000Z",
};

const task: Task = {
  id: "task-1",
  missionId: "mission-1",
  kind: "CODING",
  title: "Build runtime",
  description: "Implement runtime.",
  status: "APPROVED",
  dependsOn: [],
  createdAt: "2026-09-27T03:00:00.000Z",
  updatedAt: "2026-09-27T03:00:00.000Z",
};

const conversation: Conversation = {
  id: "conversation-1",
  kind: "MISSION",
  status: "ACTIVE",
  participantIds: ["user-1", "agent-1"],
  messageIds: [],
  missionId: "mission-1",
  createdAt: "2026-09-27T03:00:00.000Z",
  updatedAt: "2026-09-27T03:00:00.000Z",
};

describe("execution result integration", () => {
  it("takes a queued execution through runtime and publishes its result to the mission conversation", async () => {
    const stores = new InMemoryDomainStores();
    const queue = new InMemoryExecutionQueue();
    const events = new InMemoryEventStore();

    stores.executions.save(execution);
    stores.tasks.save(task);
    stores.conversations.save(conversation);
    queue.enqueue(execution);

    const coordinator = new InMemoryExecutionCoordinator({
      queue,
      runner: {
        async run(current) {
          expect(current.id).toBe("execution-1");
          expect(stores.executions.get("execution-1")?.status).toBe("RUNNING");
          return {
            status: "SUCCEEDED",
            output: "Build completed.",
          };
        },
      },
      executions: stores.executions,
      tasks: stores.tasks,
      events,
    });

    const completed = await coordinator.runNextWithResult(
      "2026-09-27T03:01:00.000Z",
      "2026-09-27T03:05:00.000Z",
    );

    expect(completed?.execution.status).toBe("SUCCEEDED");
    expect(completed?.result).toEqual({
      status: "SUCCEEDED",
      output: "Build completed.",
    });

    const output = completed!.result.status === "SUCCEEDED" ? completed!.result.output : undefined;
    if (output === undefined) {
      throw new Error("Expected a successful execution output.");
    }

    const resultInput: PersistExecutionResultInput = {
      executionId: completed!.execution.id,
      conversationId: "conversation-1",
      messageId: "message-1",
      actorId: "agent-1",
      output,
      artifacts: [
        {
          id: "artifact-1",
          kind: "CODE",
          name: "runtime.ts",
          location: "local://workspace/runtime.ts",
          createdAt: "2026-09-27T03:05:00.000Z",
        },
      ],
      createdAt: "2026-09-27T03:05:00.000Z",
    };

    const resultService = new ExecutionResultService({
      executions: stores.executions,
      conversations: stores.conversations,
      messages: stores.messages,
      artifacts: stores.artifacts,
      events,
    });

    const published = resultService.persist(resultInput);

    expect(published.message.content).toBe(output);
    expect(published.conversation.messageIds).toEqual(["message-1"]);
    expect(stores.artifacts.get("artifact-1")).toMatchObject({
      missionId: "mission-1",
      taskId: "task-1",
      executionId: "execution-1",
    });

    expect(events.listByExecution("execution-1").map((event) => event.kind)).toEqual([
      "EXECUTION_STATUS_CHANGED",
      "EXECUTION_STATUS_CHANGED",
      "MESSAGE_CREATED",
      "ARTIFACT_CREATED",
    ]);
  });
});
