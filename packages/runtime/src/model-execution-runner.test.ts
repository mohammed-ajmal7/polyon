import type { Execution, Task, TextModelResponse } from "@polyon/contracts";
import { describe, expect, it, vi } from "vitest";

import { ModelExecutionRunner } from "./model-execution-runner";
import type { ModelGateway } from "@polyon/providers";
import type { TaskStore } from "@polyon/storage";

const execution: Execution = {
  id: "execution-1",
  missionId: "mission-1",
  taskId: "task-1",
  actorId: "agent-1",
  agentId: "agent-1",
  modelId: "model-1",
  providerId: "provider-1",
  attempt: 1,
  status: "RUNNING",
  startedAt: "2026-09-27T01:05:00.000Z",
  createdAt: "2026-09-27T01:00:00.000Z",
  updatedAt: "2026-09-27T01:05:00.000Z",
};

const task: Task = {
  id: "task-1",
  missionId: "mission-1",
  kind: "ANALYSIS",
  title: "Analyze the repository",
  description: "Explain the current architecture and identify the next implementation slice.",
  status: "RUNNING",
  dependsOn: [],
  createdAt: "2026-09-27T01:00:00.000Z",
  updatedAt: "2026-09-27T01:05:00.000Z",
};

function createTaskStore(get: TaskStore["get"]): TaskStore {
  return {
    get,
    save: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(() => []),
  };
}

describe("ModelExecutionRunner", () => {
  it("builds a structured text request from the persisted task and returns model text", async () => {
    let capturedModelId: string | undefined;
    let capturedRequest:
      | {
          messages: readonly { role: string; content: string }[];
        }
      | undefined;

    const invokeText = vi.fn(
      async (
        modelId: string,
        request: {
          messages: readonly { role: string; content: string }[];
        },
      ) => {
        capturedModelId = modelId;
        capturedRequest = request;

        const output: TextModelResponse = {
          content: "Architecture analysis complete.",
          finishReason: "STOP",
        };

        return { output };
      },
    );

    const runner = new ModelExecutionRunner({
      modelGateway: { invokeText } as unknown as ModelGateway,
      tasks: createTaskStore((taskId) => (taskId === task.id ? task : undefined)),
      systemPrompt: "You are the POLYON execution agent.",
    });

    await expect(runner.run(execution)).resolves.toEqual({
      status: "SUCCEEDED",
      output: "Architecture analysis complete.",
    });

    expect(capturedModelId).toBe("model-1");
    expect(capturedRequest).toEqual({
      messages: [
        {
          role: "SYSTEM",
          content: "You are the POLYON execution agent.",
        },
        {
          role: "USER",
          content:
            "Task: Analyze the repository\n\nExplain the current architecture and identify the next implementation slice.",
        },
      ],
    });
  });

  it("fails without a bound model", async () => {
    const runner = new ModelExecutionRunner({
      modelGateway: {} as ModelGateway,
      tasks: createTaskStore(() => task),
    });

    await expect(
      runner.run({
        ...execution,
        modelId: undefined,
      }),
    ).resolves.toEqual({
      status: "FAILED",
      error: "Execution execution-1 has no bound model.",
    });
  });

  it("fails when the task cannot be recovered", async () => {
    const runner = new ModelExecutionRunner({
      modelGateway: {} as ModelGateway,
      tasks: createTaskStore(() => undefined),
    });

    await expect(runner.run(execution)).resolves.toEqual({
      status: "FAILED",
      error: "Task not found for execution execution-1: task-1.",
    });
  });

  it("converts model gateway failures into a failed runtime result", async () => {
    const runner = new ModelExecutionRunner({
      modelGateway: {
        invokeText: vi.fn(async () => {
          throw new Error("Provider unavailable.");
        }),
      } as unknown as ModelGateway,
      tasks: createTaskStore(() => task),
    });

    await expect(runner.run(execution)).resolves.toEqual({
      status: "FAILED",
      error: "Provider unavailable.",
    });
  });
});
