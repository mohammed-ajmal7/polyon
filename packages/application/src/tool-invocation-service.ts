import type {
  ActionKind,
  ActorId,
  ApprovalRequest,
  ApprovalStatus,
  DomainEvent,
  Policy,
  PolicyDecision,
  RiskLevel,
  Tool,
  ToolId,
} from "@polyon/contracts";
import { transitionApprovalStatus } from "@polyon/core";
import {
  authorizeToolInvocation,
  ToolAuthorizationError,
  type ToolAdapterRegistry,
  type ToolRegistry,
} from "@polyon/tools";
import type {
  ApprovalRequestStore,
  DomainStoreTransactionContext,
  DomainUnitOfWork,
  EventStore,
  PolicyDecisionStore,
} from "@polyon/storage";

export interface InvokeToolInput {
  readonly invocationId: string;
  readonly toolId: ToolId;
  readonly input: unknown;
  readonly action: ActionKind;
  readonly riskLevel: RiskLevel;
  readonly policy: Policy;
  readonly decisionId: string;
  readonly approvalRequestId: string;
  readonly requestedBy: ActorId;
  readonly requestedAt: string;
  readonly evaluatedAt: string;
  readonly actorId?: ActorId;
  readonly missionId?: string;
  readonly taskId?: string;
  readonly executionId?: string;
  readonly agentId?: string;
  readonly expiresAt?: string;
}

export interface ResolveToolApprovalInput {
  readonly approvalId: string;
  readonly status: Exclude<ApprovalStatus, "PENDING">;
  readonly resolvedAt: string;
  readonly resolvedBy?: ActorId;
}

export interface InvokeApprovedToolInput {
  readonly invocationId: string;
  readonly approvalId: string;
  readonly toolId: ToolId;
  readonly input: unknown;
}

export type ToolInvocationOutcome<TOutput = unknown> =
  | {
      readonly status: "SUCCEEDED";
      readonly invocationId: string;
      readonly toolId: ToolId;
      readonly policyDecision: PolicyDecision;
      readonly output: TOutput;
    }
  | {
      readonly status: "FAILED";
      readonly invocationId: string;
      readonly toolId: ToolId;
      readonly policyDecision: PolicyDecision;
      readonly error: string;
    }
  | {
      readonly status: "APPROVAL_REQUIRED";
      readonly invocationId: string;
      readonly toolId: ToolId;
      readonly policyDecision: PolicyDecision;
      readonly approvalRequest: ApprovalRequest;
    }
  | {
      readonly status: "REJECTED";
      readonly invocationId: string;
      readonly toolId: ToolId;
      readonly policyDecision: PolicyDecision;
      readonly error: string;
    };

export type ToolInvocationServiceErrorKind =
  | "TOOL_NOT_FOUND"
  | "TOOL_ADAPTER_NOT_FOUND"
  | "TOOL_APPROVAL_NOT_FOUND"
  | "TOOL_APPROVAL_NOT_APPROVED"
  | "TOOL_APPROVAL_TOOL_MISMATCH"
  | "TOOL_APPROVAL_INVOCATION_MISMATCH"
  | "TOOL_APPROVAL_POLICY_NOT_FOUND"
  | "TOOL_INVOCATION_ALREADY_RECORDED";

export class ToolInvocationServiceError extends Error {
  readonly kind: ToolInvocationServiceErrorKind;

  constructor(kind: ToolInvocationServiceErrorKind, message: string) {
    super(message);
    this.name = "ToolInvocationServiceError";
    this.kind = kind;
  }
}

type ToolInvocationStores = Pick<
  DomainStoreTransactionContext,
  "approvals" | "policyDecisions" | "events"
>;

function appendPolicyDecisionEvent(
  events: EventStore,
  decision: PolicyDecision,
  context: Pick<
    InvokeToolInput,
    "actorId" | "missionId" | "taskId" | "executionId" | "toolId"
  >,
): void {
  const event: DomainEvent = {
    id: `POLICY_DECIDED:${decision.id}`,
    kind: "POLICY_DECIDED",
    ...(context.actorId === undefined ? {} : { actorId: context.actorId }),
    ...(context.missionId === undefined ? {} : { missionId: context.missionId }),
    ...(context.taskId === undefined ? {} : { taskId: context.taskId }),
    ...(context.executionId === undefined ? {} : { executionId: context.executionId }),
    occurredAt: decision.evaluatedAt,
    data: {
      policyDecisionId: decision.id,
      policyId: decision.policyId,
      action: decision.action,
      riskLevel: decision.riskLevel,
      effect: decision.effect,
      reason: decision.reason,
      toolId: context.toolId,
    },
  };

  events.append(event);
}

function appendApprovalRequestedEvent(
  events: EventStore,
  approval: ApprovalRequest,
): void {
  events.append({
    id: `APPROVAL_REQUESTED:${approval.id}`,
    kind: "APPROVAL_REQUESTED",
    actorId: approval.requestedBy,
    ...(approval.missionId === undefined ? {} : { missionId: approval.missionId }),
    ...(approval.taskId === undefined ? {} : { taskId: approval.taskId }),
    ...(approval.executionId === undefined ? {} : { executionId: approval.executionId }),
    occurredAt: approval.requestedAt,
    data: {
      approvalRequestId: approval.id,
      action: approval.action,
      riskLevel: approval.riskLevel,
      status: approval.status,
      toolId: approval.toolId,
      invocationId: approval.invocationId,
    },
  });
}

function appendApprovalResolvedEvent(
  events: EventStore,
  approval: ApprovalRequest,
  from: ApprovalStatus,
): void {
  events.append({
    id: `APPROVAL_RESOLVED:${approval.id}:${approval.resolvedAt}`,
    kind: "APPROVAL_RESOLVED",
    ...(approval.resolvedBy === undefined ? {} : { actorId: approval.resolvedBy }),
    ...(approval.missionId === undefined ? {} : { missionId: approval.missionId }),
    ...(approval.taskId === undefined ? {} : { taskId: approval.taskId }),
    ...(approval.executionId === undefined ? {} : { executionId: approval.executionId }),
    occurredAt: approval.resolvedAt!,
    data: {
      approvalRequestId: approval.id,
      from,
      to: approval.status,
      toolId: approval.toolId,
      invocationId: approval.invocationId,
    },
  });
}

function appendToolInvocationEvent(
  events: EventStore,
  input: {
    readonly invocationId: string;
    readonly tool: Tool;
    readonly action: ActionKind;
    readonly riskLevel: RiskLevel;
    readonly status: "STARTED" | "SUCCEEDED" | "FAILED" | "REJECTED";
    readonly occurredAt: string;
    readonly actorId?: ActorId;
    readonly missionId?: string;
    readonly taskId?: string;
    readonly executionId?: string;
    readonly error?: string;
  },
): void {
  events.append({
    id: `TOOL_INVOKED:${input.invocationId}:${input.status}`,
    kind: "TOOL_INVOKED",
    ...(input.actorId === undefined ? {} : { actorId: input.actorId }),
    ...(input.missionId === undefined ? {} : { missionId: input.missionId }),
    ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
    ...(input.executionId === undefined ? {} : { executionId: input.executionId }),
    occurredAt: input.occurredAt,
    data: {
      invocationId: input.invocationId,
      toolId: input.tool.id,
      action: input.action,
      riskLevel: input.riskLevel,
      status: input.status,
      ...(input.error === undefined ? {} : { error: input.error }),
    },
  });
}

function assertInvocationNotRecorded(events: EventStore, invocationId: string): void {
  const prefix = `TOOL_INVOKED:${invocationId}:`;
  if (events.list().some((event) => event.id.startsWith(prefix))) {
    throw new ToolInvocationServiceError(
      "TOOL_INVOCATION_ALREADY_RECORDED",
      `Tool invocation already has a trace: ${invocationId}.`,
    );
  }
}

export interface ToolInvocationServiceDependencies {
  readonly tools: ToolRegistry;
  readonly adapters: ToolAdapterRegistry;
  readonly approvals: ApprovalRequestStore;
  readonly policyDecisions: PolicyDecisionStore;
  readonly events: EventStore;
  readonly unitOfWork?: DomainUnitOfWork;
}

export class ToolInvocationService {
  constructor(private readonly dependencies: ToolInvocationServiceDependencies) {}

  async invoke(input: InvokeToolInput): Promise<ToolInvocationOutcome> {
    const tool = this.getTool(input.toolId);
    assertInvocationNotRecorded(this.dependencies.events, input.invocationId);

    try {
      const authorization = authorizeToolInvocation({
        tool,
        policy: input.policy,
        action: input.action,
        riskLevel: input.riskLevel,
        decisionId: input.decisionId,
        approvalRequestId: input.approvalRequestId,
        requestedBy: input.requestedBy,
        requestedAt: input.requestedAt,
        evaluatedAt: input.evaluatedAt,
        actorId: input.actorId,
        missionId: input.missionId,
        taskId: input.taskId,
        executionId: input.executionId,
        invocationId: input.invocationId,
        agentId: input.agentId,
        expiresAt: input.expiresAt,
      });

      if (authorization.status === "APPROVAL_REQUIRED") {
        const approvalRequest = authorization.approvalRequest!;
        this.persistAuthorization(input, authorization.policyDecision, approvalRequest);
        return {
          status: "APPROVAL_REQUIRED",
          invocationId: input.invocationId,
          toolId: tool.id,
          policyDecision: authorization.policyDecision,
          approvalRequest,
        };
      }

      return await this.executeAuthorized(input, tool, authorization.policyDecision);
    } catch (error) {
      if (
        error instanceof ToolAuthorizationError &&
        error.kind === "TOOL_INVOCATION_DENIED" &&
        error.decision !== undefined
      ) {
        this.withStores((stores) => {
          stores.policyDecisions.save(error.decision!);
          appendPolicyDecisionEvent(stores.events, error.decision!, input);
          appendToolInvocationEvent(stores.events, {
            invocationId: input.invocationId,
            tool,
            action: input.action,
            riskLevel: input.riskLevel,
            status: "REJECTED",
            occurredAt: input.evaluatedAt,
            actorId: input.actorId,
            missionId: input.missionId,
            taskId: input.taskId,
            executionId: input.executionId,
            error: error.message,
          });
        });

        return {
          status: "REJECTED",
          invocationId: input.invocationId,
          toolId: tool.id,
          policyDecision: error.decision,
          error: error.message,
        };
      }

      throw error;
    }
  }

  resolveApproval(input: ResolveToolApprovalInput): ApprovalRequest {
    const approval = this.dependencies.approvals.get(input.approvalId);

    if (approval === undefined) {
      throw new ToolInvocationServiceError(
        "TOOL_APPROVAL_NOT_FOUND",
        `Tool approval not found: ${input.approvalId}.`,
      );
    }

    if (approval.toolId === undefined) {
      throw new ToolInvocationServiceError(
        "TOOL_APPROVAL_TOOL_MISMATCH",
        `Approval ${approval.id} is not bound to a tool.`,
      );
    }

    if (approval.status !== "PENDING") {
      throw new ToolInvocationServiceError(
        "TOOL_APPROVAL_NOT_APPROVED",
        `Tool approval ${approval.id} is already ${approval.status}.`,
      );
    }

    const resolved = transitionApprovalStatus(
      approval,
      input.status,
      input.resolvedAt,
      input.resolvedBy,
    );

    this.withStores((stores) => {
      stores.approvals.save(resolved);
      appendApprovalResolvedEvent(stores.events, resolved, approval.status);
    });

    return resolved;
  }

  async invokeApproved(
    input: InvokeApprovedToolInput,
  ): Promise<ToolInvocationOutcome> {
    const approval = this.dependencies.approvals.get(input.approvalId);

    if (approval === undefined) {
      throw new ToolInvocationServiceError(
        "TOOL_APPROVAL_NOT_FOUND",
        `Tool approval not found: ${input.approvalId}.`,
      );
    }

    if (approval.status !== "APPROVED") {
      throw new ToolInvocationServiceError(
        "TOOL_APPROVAL_NOT_APPROVED",
        `Tool approval ${approval.id} has status ${approval.status}.`,
      );
    }

    if (approval.toolId !== input.toolId) {
      throw new ToolInvocationServiceError(
        "TOOL_APPROVAL_TOOL_MISMATCH",
        `Tool approval ${approval.id} is not bound to tool ${input.toolId}.`,
      );
    }

    if (approval.invocationId !== input.invocationId) {
      throw new ToolInvocationServiceError(
        "TOOL_APPROVAL_INVOCATION_MISMATCH",
        `Tool approval ${approval.id} is not bound to invocation ${input.invocationId}.`,
      );
    }

    const decision = this.dependencies.policyDecisions.get(approval.policyDecisionId);

    if (decision === undefined || decision.effect !== "REQUIRE_APPROVAL") {
      throw new ToolInvocationServiceError(
        "TOOL_APPROVAL_POLICY_NOT_FOUND",
        `Approval ${approval.id} is not backed by a requiring policy decision.`,
      );
    }

    const tool = this.getTool(input.toolId);

    if (!tool.enabled || !tool.actionKinds.includes(approval.action)) {
      throw new ToolInvocationServiceError(
        "TOOL_NOT_FOUND",
        `Tool ${input.toolId} is not currently executable for action: ${approval.action}.`,
      );
    }

    assertInvocationNotRecorded(this.dependencies.events, input.invocationId);

    return this.executeAuthorized(
      input,
      tool,
      decision,
      approval.action,
      approval.riskLevel,
      {
        missionId: approval.missionId,
        taskId: approval.taskId,
        executionId: approval.executionId,
      },
    );
  }

  private async executeAuthorized(
    input: InvokeToolInput | InvokeApprovedToolInput,
    tool: Tool,
    policyDecision: PolicyDecision,
    approvedAction?: ActionKind,
    approvedRiskLevel?: RiskLevel,
    approvalContext?: {
      readonly missionId?: string;
      readonly taskId?: string;
      readonly executionId?: string;
    },
  ): Promise<ToolInvocationOutcome> {
    const action = approvedAction ?? (input as InvokeToolInput).action;
    const riskLevel =
      approvedRiskLevel ?? (input as InvokeToolInput).riskLevel;
    const context = {
      actorId: (input as InvokeToolInput).actorId,
      missionId: approvalContext?.missionId ?? (input as InvokeToolInput).missionId,
      taskId: approvalContext?.taskId ?? (input as InvokeToolInput).taskId,
      executionId:
        approvalContext?.executionId ?? (input as InvokeToolInput).executionId,
    };

    const adapter = this.dependencies.adapters.get(tool.id);

    if (adapter === undefined) {
      const error = `No adapter is registered for tool: ${tool.id}.`;
      return this.failInvocation(input, tool, policyDecision, action, riskLevel, context, error);
    }

    this.withStores((stores) => {
      if (this.dependencies.policyDecisions.get(policyDecision.id) === undefined) {
        stores.policyDecisions.save(policyDecision);
        appendPolicyDecisionEvent(stores.events, policyDecision, {
          toolId: tool.id,
          ...context,
        });
      }
      appendToolInvocationEvent(stores.events, {
        invocationId: input.invocationId,
        tool,
        action,
        riskLevel,
        status: "STARTED",
        occurredAt: new Date().toISOString(),
        ...context,
      });
    });

    try {
      const result = await adapter.invoke({ input: input.input });

      this.withStores((stores) => {
        appendToolInvocationEvent(stores.events, {
          invocationId: input.invocationId,
          tool,
          action,
          riskLevel,
          status: "SUCCEEDED",
          occurredAt: new Date().toISOString(),
          ...context,
        });
      });

      return {
        status: "SUCCEEDED",
        invocationId: input.invocationId,
        toolId: tool.id,
        policyDecision,
        output: result.output,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Tool adapter invocation failed.";

      return this.failInvocation(
        input,
        tool,
        policyDecision,
        action,
        riskLevel,
        context,
        message,
        true,
      );
    }
  }

  private failInvocation(
    input: InvokeToolInput | InvokeApprovedToolInput,
    tool: Tool,
    policyDecision: PolicyDecision,
    action: ActionKind,
    riskLevel: RiskLevel,
    context: {
      readonly actorId?: ActorId;
      readonly missionId?: string;
      readonly taskId?: string;
      readonly executionId?: string;
    },
    error: string,
    started = false,
  ): ToolInvocationOutcome {
    this.withStores((stores) => {
      if (!started && this.dependencies.policyDecisions.get(policyDecision.id) === undefined) {
        stores.policyDecisions.save(policyDecision);
        appendPolicyDecisionEvent(stores.events, policyDecision, {
          toolId: tool.id,
          ...context,
        });
      }
      appendToolInvocationEvent(stores.events, {
        invocationId: input.invocationId,
        tool,
        action,
        riskLevel,
        status: "FAILED",
        occurredAt: new Date().toISOString(),
        ...context,
        error,
      });
    });

    return {
      status: "FAILED",
      invocationId: input.invocationId,
      toolId: tool.id,
      policyDecision,
      error,
    };
  }

  private persistAuthorization(
    input: InvokeToolInput,
    decision: PolicyDecision,
    approval: ApprovalRequest,
  ): void {
    this.withStores((stores) => {
      stores.policyDecisions.save(decision);
      stores.approvals.save(approval);
      appendPolicyDecisionEvent(stores.events, decision, input);
      appendApprovalRequestedEvent(stores.events, approval);
    });
  }

  private getTool(toolId: ToolId): Tool {
    const tool = this.dependencies.tools.get(toolId);

    if (tool === undefined) {
      throw new ToolInvocationServiceError(
        "TOOL_NOT_FOUND",
        `Tool not found: ${toolId}.`,
      );
    }

    return tool;
  }

  private withStores<T>(work: (stores: ToolInvocationStores) => T): T {
    if (this.dependencies.unitOfWork === undefined) {
      return work(this.dependencies);
    }

    return this.dependencies.unitOfWork.transaction(work);
  }
}
