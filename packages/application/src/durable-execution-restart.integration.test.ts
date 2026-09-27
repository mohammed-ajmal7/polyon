/// <reference path="../../storage/src/node-runtime.d.ts" />

import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { Agent, Model, Policy, Provider, Task, TextModelResponse } from "@polyon/contracts";
import {
  InMemoryAgentRegistry,
  InMemoryModelRegistry,
  InMemoryProviderRegistry,
  type ExecutionRoutingRegistries,
} from "@polyon/agents";
import {
  InMemoryProviderAdapterRegistry,
  ModelGateway,
  type ModelProviderAdapter,
} from "@polyon/providers";
import {
  ExecutionDispatchService,
} from "@polyon/application";
import {
  InMemoryExecutionCoordinator,
  InMemoryExecutionQueue,
  InMemoryExecutionWorker,
  ModelExecutionRunner,
} from "@polyon/runtime";
import { FileDomainStores } from "@polyon/storage";
import { describe, expect, it, vi } from "vitest";

const task: Task = {
  id: "task-1",
  missionId: "mission-1",
  kind: "CODING",
  title: "Implement restart recovery",
  description: "Run the routed task after a process restart.",
  status: "READY",
  dependsOn: [],
  createdAt: "2026-09-27T01:00:00.000Z",
  updatedAt: "2026-09-27T01:00:00.000Z",
};

const policy: Policy = {
  id: "policy-1",
  name: "Allow execution",
  description: "Allows the test execution.",
  approvalMode: "AUTO",
  rules: [],
  defaultEffect: "ALLOW",
  enabled: true,
  createdAt: "2026-09-27T00:00:00.000Z",
  updatedAt: "2026-09-27T00:00:00.000Z",
};

const agent: Agent = {
  id: "agent-1",
  name: "Coder",
  role: "Coding agent",
  description: "Executes coding tasks.",
  status: "ACTIVE",
  capabilityIds: ["coding"],
  preferredModelId: "model-1",
  fallbackModelIds: [],
  createdAt: "2026-09-27T01:00:00.000Z",
  updatedAt: "2026-09-27T01:00:00.000Z",
};

const model: Model = {
  id: "model-1",
  providerId: "provider-1",
  name: "Test coding model",
  kind: "TEXT",
  capabilityIds: ["coding"],
  enabled: true,
};

const provider: Provider = {
  id: "provider-1",
  name: "Test provider",
  kind: "HOSTED_MODEL",
  enabled: true,
};

function createRouting(): ExecutionRoutingRegistries {
  const agents = new InMemoryAgentRegistry();
  const models = new InMemoryModelRegistry();
  const providers = new InMemoryProviderRegistry();

  agents.register(agent);
  models.register(model);
  providers.register(provider);

  return { agents, models, providers };
}

function createDispatchService(
  stores: FileDomainStores,
  queue: InMemoryExecutionQueue,
  routing: ExecutionRoutingRegistries,
) {
  return new ExecutionDispatchService({
    queue,
    executions: stores.executions,
    approvals: stores.approvals,
    policyDecisions: stores.policyDecisions,
    events: stores.events,
    routing,
  });
}

describe("durable routed execution restart", () => {
  it("recovers and executes a routed model-backed task after a process restart", async () => {
    const directory = mkdtempSync(join(tmpdir(), "polyon-application-restart-"));
    const adapterRegistry = new InMemoryProviderAdapterRegistry();
    const invoke = vi.fn(
      async (): Promise<{ output: TextModelResponse }> => ({
        output: {
          content: "Recovered model execution completed.",
          finishReason: "STOP",
        },
      }),
    );
    const adapter: ModelProviderAdapter = {
      providerId: "provider-1",
      invoke: invoke as ModelProviderAdapter["invoke"],
    };

    try {
      const firstProcessStores = new FileDomainStores(directory);
      const firstQueue = new InMemoryExecutionQueue();
      const firstRouting = createRouting();

      firstProcessStores.tasks.save(task);

      const dispatch = createDispatchService(
        firstProcessStores,
        firstQueue,
        firstRouting,
      );

      const dispatched = dispatch.dispatch({
        task,
        dependencies: [],
        actorId: "agent-1",
        agentId: "agent-1",
        requiredCapabilityIds: ["coding"],
        executionId: "execution-1",
        attempt: 1,
        policy,
        decisionId: "decision-1",
        approvalRequestId: "approval-1",
        requestedBy: "user-1",
        requestedAt: "2026-09-27T01:01:00.000Z",
        evaluatedAt: "2026-09-27T01:01:00.000Z",
        riskLevel: "LOW",
      });

      expect(dispatched.execution).toMatchObject({
        status: "QUEUED",
        agentId: "agent-1",
        modelId: "model-1",
        providerId: "provider-1",
      });
      expect(firstQueue.peek()?.id).toBe("execution-1");

      firstProcessStores.tasks.save({
        ...task,
        status: "APPROVED",
        updatedAt: "2026-09-27T01:01:00.000Z",
      });

      adapterRegistry.register(adapter);

      const secondProcessStores = new FileDomainStores(directory);
      const secondQueue = new InMemoryExecutionQueue();
      const secondRouting = createRouting();
      const gateway = new ModelGateway({
        models: secondRouting.models,
        providers: secondRouting.providers,
        adapters: adapterRegistry,
      });
      const runner = new ModelExecutionRunner({
        modelGateway: gateway,
        tasks: secondProcessStores.tasks,
      });
      const coordinator = new InMemoryExecutionCoordinator({
        queue: secondQueue,
        runner,
        executions: secondProcessStores.executions,
        tasks: secondProcessStores.tasks,
        events: secondProcessStores.events,
      });
      const worker = new InMemoryExecutionWorker({
        queue: secondQueue,
        coordinator,
        executions: secondProcessStores.executions,
        events: secondProcessStores.events,
        clock: {
          now: () => "2026-09-27T01:05:00.000Z",
        },
      });

      expect(secondQueue.size()).toBe(0);

      const startup = worker.start();

      expect(startup.recoveredExecutionIds).toEqual(["execution-1"]);
      expect(secondQueue.peek()).toMatchObject({
        id: "execution-1",
        agentId: "agent-1",
        modelId: "model-1",
        providerId: "provider-1",
      });

      const outcome = await worker.runNext();

      expect(outcome?.execution).toMatchObject({
        id: "execution-1",
        status: "SUCCEEDED",
        agentId: "agent-1",
        modelId: "model-1",
        providerId: "provider-1",
      });
      expect(outcome?.result).toEqual({
        status: "SUCCEEDED",
        output: "Recovered model execution completed.",
      });
      expect(invoke).toHaveBeenCalledTimes(1);
      expect(secondQueue.size()).toBe(0);
      expect(new FileDomainStores(directory).executions.get("execution-1")).toMatchObject({
        status: "SUCCEEDED",
        modelId: "model-1",
      });

      expect(
        secondProcessStores.events
          .listByExecution("execution-1")
          .map((event) => event.kind),
      ).toEqual([
        "EXECUTION_CREATED",
        "POLICY_DECIDED",
        "EXECUTION_ROUTED",
        "EXECUTION_STATUS_CHANGED",
        "EXECUTION_RECOVERED",
        "EXECUTION_STATUS_CHANGED",
        "EXECUTION_STATUS_CHANGED",
      ]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
