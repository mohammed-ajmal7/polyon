import type {
  ActorId,
  ApprovalRequest,
  ApprovalStatus,
  Policy,
  PolicyDecision,
  RiskLevel,
} from "@polyon/contracts";
import { transitionApprovalStatus } from "@polyon/core";
import type {
  ApprovalRequestStore,
  DomainStoreTransactionContext,
  DomainUnitOfWork,
  EventStore,
  PolicyDecisionStore,
} from "@polyon/storage";
import {
  authorizeIntegrationInvocation,
  type IntegrationAdapter,
  type IntegrationId,
  type IntegrationInvocationResult,
  type IntegrationAdapterRegistry,
} from "@polyon/integrations";

export interface InvokeIntegrationInput<TInput = unknown> {
  readonly invocationId: string;
  readonly integrationId: IntegrationId;
  readonly operation: string;
  readonly input: TInput;
  readonly action: import("@polyon/contracts").ActionKind;
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

export interface InvokeApprovedIntegrationInput<TInput = unknown> {
  readonly invocationId: string;
  readonly approvalId: string;
  readonly integrationId: IntegrationId;
  readonly operation: string;
  readonly input: TInput;
}

export type IntegrationInvocationOutcome<TOutput = unknown> =
  | {
      readonly status: "SUCCEEDED";
      readonly invocationId: string;
      readonly integrationId: IntegrationId;
      readonly policyDecision: PolicyDecision;
      readonly output: TOutput;
    }
  | {
      readonly status: "FAILED";
      readonly invocationId: string;
      readonly integrationId: IntegrationId;
      readonly policyDecision: PolicyDecision;
      readonly error: string;
    }
  | {
      readonly status: "APPROVAL_REQUIRED";
      readonly invocationId: string;
      readonly integrationId: IntegrationId;
      readonly policyDecision: PolicyDecision;
      readonly approvalRequest: ApprovalRequest;
    }
  | {
      readonly status: "REJECTED";
      readonly invocationId: string;
      readonly integrationId: IntegrationId;
      readonly policyDecision: PolicyDecision;
      readonly error: string;
    };

export type IntegrationInvocationServiceErrorKind =
  | "INTEGRATION_NOT_FOUND"
  | "INTEGRATION_APPROVAL_NOT_FOUND"
  | "INTEGRATION_APPROVAL_NOT_APPROVED"
  | "INTEGRATION_APPROVAL_INTEGRATION_MISMATCH"
  | "INTEGRATION_APPROVAL_INVOCATION_MISMATCH"
  | "INTEGRATION_INVOCATION_ALREADY_RECORDED";

export class IntegrationInvocationServiceError extends Error {
  readonly kind: IntegrationInvocationServiceErrorKind;

  constructor(kind: IntegrationInvocationServiceErrorKind, message: string) {
    super(message);
    this.name = "IntegrationInvocationServiceError";
    this.kind = kind;
  }
}

type IntegrationInvocationStores = Pick<
  DomainStoreTransactionContext,
  "approvals" | "policyDecisions" | "events"
>;

export interface IntegrationInvocationServiceDependencies {
  readonly integrations: IntegrationAdapterRegistry;
  readonly approvals: ApprovalRequestStore;
  readonly policyDecisions: PolicyDecisionStore;
  readonly events: EventStore;
  readonly unitOfWork?: DomainUnitOfWork;
}

export class IntegrationInvocationService {
  constructor(
    private readonly dependencies: IntegrationInvocationServiceDependencies,
  ) {}

  async invoke<TInput = unknown>(
    input: InvokeIntegrationInput<TInput>,
  ): Promise<IntegrationInvocationOutcome> {
    const integration = this.getIntegration(input.integrationId);

    this.assertNotRecorded(input.invocationId);

    const authorization = authorizeIntegrationInvocation({
      integration,
      integrationId: input.integrationId,
      invocationId: input.invocationId,
      action: input.action,
      policy: input.policy,
      riskLevel: input.riskLevel,
      decisionId: input.decisionId,
      approvalRequestId: input.approvalRequestId,
      requestedBy: input.requestedBy,
      requestedAt: input.requestedAt,
      evaluatedAt: input.evaluatedAt,
      actorId: input.actorId,
      agentId: input.agentId,
      missionId: input.missionId,
      taskId: input.taskId,
      executionId: input.executionId,
      expiresAt: input.expiresAt,
    });

    if (authorization.status === "APPROVAL_REQUIRED") {
      const approval = {
        ...authorization.approvalRequest!,
        integrationId: integration.integrationId,
        reason: `Integration ${integration.integrationId} requested operation ${input.operation}: ${authorization.policyDecision.reason}`,
      };

      this.withStores((stores) => {
        if (stores.policyDecisions.get(authorization.policyDecision.id) === undefined) {
          stores.policyDecisions.save(authorization.policyDecision);
          stores.events.append({
            id: `POLICY_DECIDED:${authorization.policyDecision.id}`,
            kind: "POLICY_DECIDED",
            ...(input.actorId === undefined ? {} : { actorId: input.actorId }),
            ...(input.missionId === undefined ? {} : { missionId: input.missionId }),
            ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
            ...(input.executionId === undefined ? {} : { executionId: input.executionId }),
            occurredAt: authorization.policyDecision.evaluatedAt,
            data: {
              policyDecisionId: authorization.policyDecision.id,
              policyId: authorization.policyDecision.policyId,
              integrationId: integration.integrationId,
              operation: input.operation,
              action: input.action,
              riskLevel: input.riskLevel,
              effect: authorization.policyDecision.effect,
            },
          });
        }

        stores.approvals.save(approval);
        stores.events.append({
          id: `APPROVAL_REQUESTED:${approval.id}`,
          kind: "APPROVAL_REQUESTED",
          actorId: approval.requestedBy,
          ...(approval.missionId === undefined ? {} : { missionId: approval.missionId }),
          ...(approval.taskId === undefined ? {} : { taskId: approval.taskId }),
          ...(approval.executionId === undefined ? {} : { executionId: approval.executionId }),
          occurredAt: approval.requestedAt,
          data: {
            approvalRequestId: approval.id,
            integrationId: integration.integrationId,
            invocationId: input.invocationId,
            operation: input.operation,
            action: input.action,
            riskLevel: input.riskLevel,
            status: approval.status,
          },
        });
      });

      return {
        status: "APPROVAL_REQUIRED",
        invocationId: input.invocationId,
        integrationId: input.integrationId,
        policyDecision: authorization.policyDecision,
        approvalRequest: approval,
      };
    }

    this.persistPolicyDecision(
      authorization.policyDecision,
      input,
      integration,
    );

    return this.execute(integration, input, authorization.policyDecision);
  }

  resolveApproval(input: {
    readonly approvalId: string;
    readonly status: Exclude<ApprovalStatus, "PENDING">;
    readonly resolvedAt: string;
    readonly resolvedBy?: ActorId;
  }): ApprovalRequest {
    const approval = this.dependencies.approvals.get(input.approvalId);

    if (approval === undefined || approval.integrationId === undefined) {
      throw new IntegrationInvocationServiceError(
        "INTEGRATION_APPROVAL_NOT_FOUND",
        `Integration approval not found: ${input.approvalId}.`,
      );
    }

    const updated = transitionApprovalStatus(approval, input.status, input.resolvedAt, input.resolvedBy);

    this.withStores((stores) => {
      stores.approvals.save(updated);
      stores.events.append({
        id: `APPROVAL_RESOLVED:${updated.id}:${updated.resolvedAt}`,
        kind: "APPROVAL_RESOLVED",
        ...(input.resolvedBy === undefined ? {} : { actorId: input.resolvedBy }),
        ...(updated.missionId === undefined ? {} : { missionId: updated.missionId }),
        ...(updated.taskId === undefined ? {} : { taskId: updated.taskId }),
        ...(updated.executionId === undefined ? {} : { executionId: updated.executionId }),
        occurredAt: updated.resolvedAt!,
        data: {
          approvalRequestId: updated.id,
          integrationId: updated.integrationId,
          from: approval.status,
          to: updated.status,
        },
      });
    });

    return updated;
  }

  async invokeApproved<TInput = unknown>(
    input: InvokeApprovedIntegrationInput<TInput>,
  ): Promise<IntegrationInvocationOutcome> {
    const approval = this.dependencies.approvals.get(input.approvalId);

    if (approval === undefined || approval.integrationId === undefined) {
      throw new IntegrationInvocationServiceError(
        "INTEGRATION_APPROVAL_NOT_FOUND",
        `Integration approval not found: ${input.approvalId}.`,
      );
    }

    if (approval.status !== "APPROVED") {
      throw new IntegrationInvocationServiceError(
        "INTEGRATION_APPROVAL_NOT_APPROVED",
        `Integration approval is not approved: ${input.approvalId}.`,
      );
    }

    if (approval.integrationId !== input.integrationId) {
      throw new IntegrationInvocationServiceError(
        "INTEGRATION_APPROVAL_INTEGRATION_MISMATCH",
        `Integration approval does not match integration: ${input.integrationId}.`,
      );
    }

    if (approval.invocationId !== input.invocationId) {
      throw new IntegrationInvocationServiceError(
        "INTEGRATION_APPROVAL_INVOCATION_MISMATCH",
        `Integration approval does not match invocation: ${input.invocationId}.`,
      );
    }

    this.assertNotRecorded(input.invocationId);

    const integration = this.getIntegration(input.integrationId);

    const policyDecision = this.dependencies.policyDecisions.get(
      approval.policyDecisionId,
    );

    if (policyDecision === undefined) {
      throw new IntegrationInvocationServiceError(
        "INTEGRATION_APPROVAL_NOT_FOUND",
        `Policy decision for integration approval is missing: ${approval.policyDecisionId}.`,
      );
    }

    return this.execute(
      integration,
      {
        invocationId: input.invocationId,
        integrationId: input.integrationId,
        operation: input.operation,
        input: input.input,
        actorId: approval.resolvedBy ?? approval.requestedBy,
        missionId: approval.missionId,
        taskId: approval.taskId,
        executionId: approval.executionId,
      },
      policyDecision,
    );
  }

  private async execute(
    integration: IntegrationAdapter,
    input: {
      readonly invocationId: string;
      readonly integrationId: IntegrationId;
      readonly operation: string;
      readonly input: unknown;
      readonly actorId?: ActorId;
      readonly missionId?: string;
      readonly taskId?: string;
      readonly executionId?: string;
      readonly agentId?: string;
    },
    policyDecision: PolicyDecision,
  ): Promise<IntegrationInvocationOutcome> {
    try {
      const result: IntegrationInvocationResult = await integration.invoke({
        operation: input.operation,
        input: input.input,
      });

      this.dependencies.events.append({
        id: `INTEGRATION_INVOKED:${input.invocationId}:SUCCEEDED`,
        kind: "INTEGRATION_INVOKED",
        ...(input.actorId === undefined ? {} : { actorId: input.actorId }),
        ...(input.missionId === undefined ? {} : { missionId: input.missionId }),
        ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
        ...(input.executionId === undefined ? {} : { executionId: input.executionId }),
        occurredAt: new Date().toISOString(),
        data: {
          invocationId: input.invocationId,
          integrationId: input.integrationId,
          operation: input.operation,
          status: "SUCCEEDED",
        },
      });

      return {
        status: "SUCCEEDED",
        invocationId: input.invocationId,
        integrationId: input.integrationId,
        policyDecision,
        output: result.output,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      this.dependencies.events.append({
        id: `INTEGRATION_INVOKED:${input.invocationId}:FAILED`,
        kind: "INTEGRATION_INVOKED",
        ...(input.actorId === undefined ? {} : { actorId: input.actorId }),
        ...(input.missionId === undefined ? {} : { missionId: input.missionId }),
        ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
        ...(input.executionId === undefined ? {} : { executionId: input.executionId }),
        occurredAt: new Date().toISOString(),
        data: {
          invocationId: input.invocationId,
          integrationId: input.integrationId,
          operation: input.operation,
          status: "FAILED",
          error: message,
        },
      });

      return {
        status: "FAILED",
        invocationId: input.invocationId,
        integrationId: input.integrationId,
        policyDecision,
        error: message,
      };
    }
  }

  private getIntegration(integrationId: IntegrationId): IntegrationAdapter {
    const integration = this.dependencies.integrations.get(integrationId);

    if (integration === undefined) {
      throw new IntegrationInvocationServiceError(
        "INTEGRATION_NOT_FOUND",
        `Integration not found: ${integrationId}.`,
      );
    }

    return integration;
  }

  private persistPolicyDecision(
    decision: PolicyDecision,
    input: Pick<
      InvokeIntegrationInput,
      "actorId" | "missionId" | "taskId" | "executionId" | "operation"
    >,
    integration: IntegrationAdapter,
  ): void {
    this.withStores((stores) => {
      if (stores.policyDecisions.get(decision.id) !== undefined) {
        return;
      }

      stores.policyDecisions.save(decision);
      stores.events.append({
        id: `POLICY_DECIDED:${decision.id}`,
        kind: "POLICY_DECIDED",
        ...(input.actorId === undefined ? {} : { actorId: input.actorId }),
        ...(input.missionId === undefined ? {} : { missionId: input.missionId }),
        ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
        ...(input.executionId === undefined ? {} : { executionId: input.executionId }),
        occurredAt: decision.evaluatedAt,
        data: {
          policyDecisionId: decision.id,
          policyId: decision.policyId,
          integrationId: integration.integrationId,
          operation: input.operation,
          action: decision.action,
          riskLevel: decision.riskLevel,
          effect: decision.effect,
        },
      });
    });
  }

  private withStores(work: (stores: IntegrationInvocationStores) => void): void {
    if (this.dependencies.unitOfWork === undefined) {
      work({
        approvals: this.dependencies.approvals,
        policyDecisions: this.dependencies.policyDecisions,
        events: this.dependencies.events,
      });
      return;
    }

    this.dependencies.unitOfWork.transaction(work);
  }

  private assertNotRecorded(invocationId: string): void {
    if (
      this.dependencies.events
        .list()
        .some((event) => event.kind === "INTEGRATION_INVOKED" && event.data.invocationId === invocationId)
    ) {
      throw new IntegrationInvocationServiceError(
        "INTEGRATION_INVOCATION_ALREADY_RECORDED",
        `Integration invocation already has a trace: ${invocationId}.`,
      );
    }
  }
}
