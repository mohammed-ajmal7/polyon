import type { Execution } from "@polyon/contracts";
import { describe, expect, it } from "vitest";

import { ExecutionQueueError, InMemoryExecutionQueue } from "./execution-queue";

const queuedExecution = (id: string): Execution => ({
  id,
  missionId: "mission-1",
  taskId: "task-1",
  actorId: "agent-1",
  attempt: 1,
  status: "QUEUED",
  createdAt: "2026-09-27T01:00:00.000Z",
  updatedAt: "2026-09-27T01:00:00.000Z",
});

describe("InMemoryExecutionQueue", () => {
  it("enqueues and dequeues executions in FIFO order", () => {
    const queue = new InMemoryExecutionQueue();
    queue.enqueue(queuedExecution("execution-1"));
    queue.enqueue(queuedExecution("execution-2"));

    expect(queue.size()).toBe(2);
    expect(queue.dequeue()?.id).toBe("execution-1");
    expect(queue.dequeue()?.id).toBe("execution-2");
    expect(queue.size()).toBe(0);
  });

  it("reports whether an execution is queued", () => {
    const queue = new InMemoryExecutionQueue();

    expect(queue.has("execution-1")).toBe(false);

    queue.enqueue(queuedExecution("execution-1"));

    expect(queue.has("execution-1")).toBe(true);

    queue.dequeue();

    expect(queue.has("execution-1")).toBe(false);
  });

  it("removes a specific queued execution without changing FIFO order", () => {
    const queue = new InMemoryExecutionQueue();
    queue.enqueue(queuedExecution("execution-1"));
    queue.enqueue(queuedExecution("execution-2"));
    queue.enqueue(queuedExecution("execution-3"));

    expect(queue.remove("execution-2")?.id).toBe("execution-2");
    expect(queue.peek()?.id).toBe("execution-1");
    expect(queue.dequeue()?.id).toBe("execution-1");
    expect(queue.dequeue()?.id).toBe("execution-3");
    expect(queue.remove("missing")).toBeUndefined();
  });

  it("rejects duplicate queued executions", () => {
    const queue = new InMemoryExecutionQueue();
    const execution = queuedExecution("execution-1");

    queue.enqueue(execution);

    expect(() => queue.enqueue(execution)).toThrowError(
      new ExecutionQueueError("EXECUTION_ALREADY_QUEUED", "execution-1", "QUEUED"),
    );
  });

  it("peeks without removing the execution", () => {
    const queue = new InMemoryExecutionQueue();
    queue.enqueue(queuedExecution("execution-1"));

    expect(queue.peek()?.id).toBe("execution-1");
    expect(queue.size()).toBe(1);
  });

  it("returns undefined when empty", () => {
    const queue = new InMemoryExecutionQueue();

    expect(queue.peek()).toBeUndefined();
    expect(queue.dequeue()).toBeUndefined();
  });

  it("rejects executions that are not queued", () => {
    const queue = new InMemoryExecutionQueue();

    expect(() =>
      queue.enqueue({
        ...queuedExecution("execution-1"),
        status: "RUNNING",
      }),
    ).toThrowError(new ExecutionQueueError("EXECUTION_NOT_QUEUED", "execution-1", "RUNNING"));
  });

  it("does not expose mutable queue state", () => {
    const queue = new InMemoryExecutionQueue();
    const execution = queuedExecution("execution-1");

    queue.enqueue(execution);

    const retrieved = queue.peek()!;
    (retrieved as { status: Execution["status"] }).status = "FAILED";

    expect(queue.peek()?.status).toBe("QUEUED");
  });

  it("does not mutate the queued source execution", () => {
    const queue = new InMemoryExecutionQueue();
    const execution = queuedExecution("execution-1");

    queue.enqueue(execution);

    expect(execution.status).toBe("QUEUED");
    expect(execution.updatedAt).toBe("2026-09-27T01:00:00.000Z");
  });
});
