import type { ApprovalRequest, Agent, Execution, Model, Provider } from "@polyon/contracts";
import {
  InMemoryAgentRegistry,
  InMemoryModelRegistry,
  InMemoryProviderRegistry,
  type ExecutionRoutingRegistries,
} from "@polyon/agents";
import { describe, expect, it } from "vitest";

import { InMemoryExecutionQueue } from "@polyon/runtime";
import { InMemoryDomainStores, InMemoryEventStore } from "@polyon/storage";

import { ExecutionDispatchService } from "./execution-dispatch-service";

const task = {
  id: "task-1",
  missionId: "mission-1",
  kind: "CODING" as const,
  title: "Build runtime",
  description: "Implement runtime.",
  status: "READY" as const,
  dependsOn: [],
  createdAt: "2026-09-27T01:00:00.000Z",
  updatedAt: "2026-09-27T01:00:00.000Z",
};

const basePolicy = {
  id: "policy-1",
  name: "Execution policy",
  description: "Controls execution runs.",
  approvalMode: "BALANCED" as const,
  rules: [],
  defaultEffect: "ALLOW" as const,
  enabled: true,
  createdAt: "2026-09-27T00:00:00.000Z",
  updatedAt: "2026-09-27T00:00:00.000Z",
};

const input = {
  task,
  dependencies: [],
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

function createRouting(): ExecutionRoutingRegistries {
  const agents = new InMemoryAgentRegistry();
  const models = new InMemoryModelRegistry();
  const providers = new InMemoryProviderRegistry();

  const agent: Agent = {
    id: "agent-1",
    name: "Coder",
    role: "Coding agent",
    description: "Writes code.",
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
    name: "Coding model",
    kind: "TEXT",
    capabilityIds: ["coding"],
    enabled: true,
  };
  const provider: Provider = {
    id: "provider-1",
    name: "Provider",
    kind: "HOSTED_MODEL",
    enabled: true,
  };

  agents.register(agent);
  models.register(model);
  providers.register(provider);

  return { agents, models, providers };
}

function createService(routing?: ExecutionRoutingRegistries) {
  const stores = new InMemoryDomainStores();
  const queue = new InMemoryExecutionQueue();
  const events = new InMemoryEventStore();

  return {
    stores,
    queue,
    events,
    service: new ExecutionDispatchService({
      queue,
      executions: stores.executions,
      approvals: stores.approvals,
      policyDecisions: stores.policyDecisions,
      events,
      routing,
    }),
  };
}

describe("ExecutionDispatchService", () => {
  it("runs execution state persistence through the supplied unit of work", () => {
    const stores = new InMemoryDomainStores();
    const queue = new InMemoryExecutionQueue();

    let transactionCalls = 0;
    const unitOfWork = {
      transaction<T>(
        work: Parameters<InMemoryDomainStores["transaction"]>[0],
      ): T {
        transactionCalls += 1;
        return stores.transaction(work) as T;
      },
    };

    const service = new ExecutionDispatchService({
      queue,
      executions: stores.executions,
      approvals: stores.approvals,
      policyDecisions: stores.policyDecisions,
      events: stores.events,
      unitOfWork,
    });

    const result = service.dispatch(input);

    expect(transactionCalls).toBe(1);
    expect(result.execution.status).toBe("QUEUED");
    expect(stores.executions.get("execution-1")).toEqual(result.execution);
    expect(stores.policyDecisions.get("decision-1")).toEqual(result.policyDecision);
    expect(stores.events.get("EXECUTION_CREATED:execution-1")).toBeDefined();
    expect(queue.peek()?.id).toBe("execution-1");
  });

  it("persists and enqueues an allowed execution", () => {
    const { stores, queue, service } = createService();

    expect(service.dispatch(input)).toMatchObject({
      execution: { status: "QUEUED" },
      policyDecision: { effect: "ALLOW" },
      nextStep: "ENQUEUE",
    });

    expect(stores.executions.get("execution-1")?.status).toBe("QUEUED");
    expect(stores.policyDecisions.get("decision-1")?.effect).toBe("ALLOW");
    expect(queue.peek()?.id).toBe("execution-1");
  });

  it("records dispatch trace events for an allowed execution", () => {
    const { events, service } = createService();

    service.dispatch(input);

    expect(events.list().map((event) => event.kind)).toEqual([
      "EXECUTION_CREATED",
      "POLICY_DECIDED",
      "EXECUTION_STATUS_CHANGED",
    ]);
    expect(events.listByExecution("execution-1")[2]?.data).toEqual({
      from: "PENDING",
      to: "QUEUED",
    });
  });

  it("binds the selected agent, model, and provider before enqueueing", () => {
    const { stores, queue, events, service } = createService(createRouting());

    const result = service.dispatch({
      ...input,
      requiredCapabilityIds: ["coding"],
    });

    expect(result.execution).toMatchObject({
      status: "QUEUED",
      agentId: "agent-1",
      modelId: "model-1",
      providerId: "provider-1",
    });
    expect(stores.executions.get("execution-1")).toEqual(result.execution);
    expect(queue.peek()?.modelId).toBe("model-1");
    expect(events.list().map((event) => event.kind)).toEqual([
      "EXECUTION_CREATED",
      "POLICY_DECIDED",
      "EXECUTION_ROUTED",
      "EXECUTION_STATUS_CHANGED",
    ]);
    expect(events.get("EXECUTION_ROUTED:execution-1")?.data).toEqual({
      agentId: "agent-1",
      modelId: "model-1",
      providerId: "provider-1",
      source: "PREFERRED",
    });
  });

  it("fails closed before persistence when no compatible model can be routed", () => {
    const agents = new InMemoryAgentRegistry();
    const models = new InMemoryModelRegistry();
    const providers = new InMemoryProviderRegistry();

    agents.register({
      id: "agent-1",
      name: "Coder",
      role: "Coding agent",
      description: "Writes code.",
      status: "ACTIVE",
      capabilityIds: ["coding"],
      preferredModelId: "missing-model",
      fallbackModelIds: [],
      createdAt: "2026-09-27T01:00:00.000Z",
      updatedAt: "2026-09-27T01:00:00.000Z",
    });

    const routing: ExecutionRoutingRegistries = { agents, models, providers };
    const { stores, queue, events, service } = createService(routing);

    expect(() =>
      service.dispatch({
        ...input,
        requiredCapabilityIds: ["coding"],
      }),
    ).toThrow("No compatible enabled model is available for agent: agent-1.");
    expect(stores.executions.get("execution-1")).toBeUndefined();
    expect(stores.policyDecisions.get("decision-1")).toBeUndefined();
    expect(queue.size()).toBe(0);
    expect(events.list()).toEqual([]);
  });

  it("persists an approval-required execution without enqueueing it", () => {
    const { stores, queue, service } = createService();

    const result = service.dispatch({
      ...input,
      policy: {
        ...basePolicy,
        defaultEffect: "REQUIRE_APPROVAL" as const,
      },
    });

    expect(result.execution.status).toBe("APPROVAL_REQUIRED");
    expect(result.nextStep).toBe("AWAIT_APPROVAL");
    expect(stores.approvals.get("approval-1")?.status).toBe("PENDING");
    expect(queue.size()).toBe(0);
  });

  it("persists policy denial as a rejected execution", () => {
    const { stores, queue, service } = createService();

    const result = service.dispatch({
      ...input,
      policy: {
        ...basePolicy,
        defaultEffect: "DENY" as const,
      },
    });

    expect(result.execution.status).toBe("REJECTED");
    expect(result.nextStep).toBe("REJECTED");
    expect(queue.size()).toBe(0);
  });

  it("rejects duplicate execution identifiers", () => {
    const stores = new InMemoryDomainStores();

    stores.executions.save({
      id: "execution-1",
      missionId: "mission-1",
      taskId: "task-1",
      actorId: "agent-1",
      attempt: 1,
      status: "PENDING",
      createdAt: "2026-09-27T01:00:00.000Z",
      updatedAt: "2026-09-27T01:00:00.000Z",
    });

    const service = new ExecutionDispatchService({
      queue: new InMemoryExecutionQueue(),
      executions: stores.executions,
      approvals: stores.approvals,
      policyDecisions: stores.policyDecisions,
      events: new InMemoryEventStore(),
    });

    expect(() => service.dispatch(input)).toThrow("Execution already exists: execution-1.");
  });

  it("moves an approved execution to the queue", () => {
    const { queue, service } = createService();

    const approval: ApprovalRequest = {
      id: "approval-1",
      policyId: "policy-1",
      policyDecisionId: "decision-1",
      missionId: "mission-1",
      taskId: "task-1",
      executionId: "execution-1",
      action: "EXECUTION_RUN",
      riskLevel: "MEDIUM",
      requestedBy: "user-1",
      reason: "Needs approval.",
      status: "APPROVED",
      requestedAt: "2026-09-27T01:01:00.000Z",
    };

    const execution: Execution = {
      id: "execution-1",
      missionId: "mission-1",
      taskId: "task-1",
      actorId: "agent-1",
      attempt: 1,
      status: "APPROVAL_REQUIRED",
      createdAt: "2026-09-27T01:00:00.000Z",
      updatedAt: "2026-09-27T01:01:00.000Z",
    };

    expect(service.queueApproved(approval, execution, "2026-09-27T01:02:00.000Z")).toMatchObject({
      status: "QUEUED",
      updatedAt: "2026-09-27T01:02:00.000Z",
    });
    expect(queue.peek()?.id).toBe("execution-1");
  });

  it("does not enqueue a rejected execution", () => {
    const { queue, service } = createService();

    const rejected = service.dispatch({
      ...input,
      policy: {
        ...basePolicy,
        defaultEffect: "DENY" as const,
      },
    });

    expect(rejected.execution.status).toBe("REJECTED");
    expect(queue.size()).toBe(0);
  });
});
