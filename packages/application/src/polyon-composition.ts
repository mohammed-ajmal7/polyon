import type { Agent, Model, Policy, Provider } from "@polyon/contracts";
import { AgentGateway, InMemoryAgentRegistry, InMemoryModelRegistry, InMemoryProviderRegistry } from "@polyon/agents";
import { ExecutionApprovalService, ExecutionDispatchService, ExecutionResultService, AgentToolOrchestrationService, ExecutionRetryService, MissionExecutionService, MissionTaskOrchestrationService, ToolInvocationService, type ReadyTaskHandler } from "@polyon/application";
import { InMemoryProviderAdapterRegistry, ModelGateway, type ModelProviderAdapter } from "@polyon/providers";
import { FileDomainStores } from "@polyon/storage";
import { createExecutionRuntime, ModelExecutionRunner, type ExecutionRunOutcome, type ExecutionRuntime, type ExecutionRuntimeCompletionHandler, type ExecutionRuntimeWait, type ExecutionWorkerClock } from "@polyon/runtime";
import { createInMemoryBuiltinToolRegistries, registerBuiltinTools, type ToolAdapterRegistry, type ToolRegistry } from "@polyon/tools";

export interface PolyonProviderRegistration {
  readonly provider: Provider;
  readonly adapter: ModelProviderAdapter;
}

export interface PolyonCompositionOptions {
  readonly storageRoot: string;
  readonly agents?: readonly Agent[];
  readonly models?: readonly Model[];
  readonly providers?: readonly PolyonProviderRegistration[];
  readonly filesystemRoot?: string;
  readonly filesystemReadMaxBytes?: number;
  readonly filesystemReadEnabled?: boolean;
  readonly terminalRoot?: string;
  readonly terminalAllowedCommands?: readonly string[];
  readonly terminalDefaultTimeoutMs?: number;
  readonly terminalMaxTimeoutMs?: number;
  readonly terminalMaxOutputBytes?: number;
  readonly terminalEnvironmentKeys?: readonly string[];
  readonly terminalEnabled?: boolean;
  readonly gitRoot?: string;
  readonly gitExecutable?: string;
  readonly gitDefaultTimeoutMs?: number;
  readonly gitMaxTimeoutMs?: number;
  readonly gitMaxOutputBytes?: number;
  readonly gitEnvironmentKeys?: readonly string[];
  readonly gitEnabled?: boolean;
  readonly gitWriteRoot?: string;
  readonly gitWriteExecutable?: string;
  readonly gitWriteDefaultTimeoutMs?: number;
  readonly gitWriteMaxTimeoutMs?: number;
  readonly gitWriteMaxOutputBytes?: number;
  readonly gitWriteEnvironmentKeys?: readonly string[];
  readonly gitWriteEnabled?: boolean;
  readonly toolPolicy?: Policy;
  readonly toolRequiredCapabilityIds?: readonly string[];
  readonly maxToolRounds?: number;
  readonly clock?: ExecutionWorkerClock;
  readonly executionTimeoutMs?: number;
  readonly pollIntervalMs?: number;
  readonly maxConcurrency?: number;
  readonly retryBackoffInitialMs?: number;
  readonly retryBackoffMaxMs?: number;
  readonly wait?: ExecutionRuntimeWait;
  readonly onError?: (error: unknown) => void;
  readonly onExecutionCompleted?: ExecutionRuntimeCompletionHandler;
  readonly onReadyTasks?: ReadyTaskHandler;
}

export interface PolyonComposition {
  readonly stores: FileDomainStores;
  readonly agents: InMemoryAgentRegistry;
  readonly models: InMemoryModelRegistry;
  readonly providers: InMemoryProviderRegistry;
  readonly providerAdapters: InMemoryProviderAdapterRegistry;
  readonly modelGateway: ModelGateway;
  readonly agentGateway: AgentGateway;
  readonly tools: ToolRegistry;
  readonly toolAdapters: ToolAdapterRegistry;
  readonly executionDispatch: ExecutionDispatchService;
  readonly missionExecution: MissionExecutionService;
  readonly taskOrchestration: MissionTaskOrchestrationService;
  readonly executionResults: ExecutionResultService;
  readonly executionApproval: ExecutionApprovalService;
  readonly executionRetry: ExecutionRetryService;
  readonly toolInvocation: ToolInvocationService;
  readonly agentToolOrchestration: AgentToolOrchestrationService;
  readonly runtime: ExecutionRuntime;
}

class SystemClock implements ExecutionWorkerClock {
  now(): string {
    return new Date().toISOString();
  }
}

export function createPolyonComposition(options: PolyonCompositionOptions): PolyonComposition {
  const stores = new FileDomainStores(options.storageRoot);
  const agents = new InMemoryAgentRegistry();
  const models = new InMemoryModelRegistry();
  const providers = new InMemoryProviderRegistry();
  const providerAdapters = new InMemoryProviderAdapterRegistry();

  for (const agent of options.agents ?? []) agents.register(agent);
  for (const model of options.models ?? []) models.register(model);
  for (const registration of options.providers ?? []) {
    providers.register(registration.provider);
    providerAdapters.register(registration.adapter);
  }

  const modelGateway = new ModelGateway({ models, providers, adapters: providerAdapters });
  const agentGateway = new AgentGateway({ agents, models, providers, modelGateway });
  const builtinTools = createInMemoryBuiltinToolRegistries();

  if (
    options.filesystemRoot !== undefined ||
    (options.terminalRoot !== undefined &&
      options.terminalAllowedCommands !== undefined) ||
    options.gitRoot !== undefined ||
    options.gitWriteRoot !== undefined
  ) {
    registerBuiltinTools(builtinTools, {
      filesystemRoot: options.filesystemRoot,
      filesystemReadMaxBytes: options.filesystemReadMaxBytes,
      filesystemReadEnabled: options.filesystemReadEnabled,
      terminalRoot: options.terminalRoot,
      terminalAllowedCommands: options.terminalAllowedCommands,
      terminalDefaultTimeoutMs: options.terminalDefaultTimeoutMs,
      terminalMaxTimeoutMs: options.terminalMaxTimeoutMs,
      terminalMaxOutputBytes: options.terminalMaxOutputBytes,
      terminalEnvironmentKeys: options.terminalEnvironmentKeys,
      terminalEnabled: options.terminalEnabled,
      gitRoot: options.gitRoot,
      gitExecutable: options.gitExecutable,
      gitDefaultTimeoutMs: options.gitDefaultTimeoutMs,
      gitMaxTimeoutMs: options.gitMaxTimeoutMs,
      gitMaxOutputBytes: options.gitMaxOutputBytes,
      gitEnvironmentKeys: options.gitEnvironmentKeys,
      gitEnabled: options.gitEnabled,
      gitWriteRoot: options.gitWriteRoot,
      gitWriteExecutable: options.gitWriteExecutable,
      gitWriteDefaultTimeoutMs: options.gitWriteDefaultTimeoutMs,
      gitWriteMaxTimeoutMs: options.gitWriteMaxTimeoutMs,
      gitWriteMaxOutputBytes: options.gitWriteMaxOutputBytes,
      gitWriteEnvironmentKeys: options.gitWriteEnvironmentKeys,
      gitWriteEnabled: options.gitWriteEnabled,
    });
  }

  let executionResults: ExecutionResultService | undefined;

  const publishExecutionCompletion = async (
    outcome: ExecutionRunOutcome,
  ): Promise<void> => {
    const externalHandler = options.onExecutionCompleted;

    if (executionResults !== undefined) {
      const conversation = stores.conversations
        .list()
        .find(
          (candidate) =>
            candidate.kind === "MISSION" &&
            candidate.status === "ACTIVE" &&
            candidate.missionId === outcome.execution.missionId,
        );

      if (conversation !== undefined) {
        const output =
          outcome.result.status === "SUCCEEDED"
            ? outcome.result.output ?? ""
            : outcome.result.error ?? "Execution did not produce a result.";

        executionResults.persist({
          executionId: outcome.execution.id,
          conversationId: conversation.id,
          messageId: `execution-result:${outcome.execution.id}`,
          actorId: outcome.execution.actorId,
          output,
          createdAt:
            outcome.execution.completedAt ??
            outcome.execution.updatedAt,
        });
      }
    }

    await externalHandler?.(outcome);
  };

  const toolInvocation = new ToolInvocationService({
    tools: builtinTools.tools,
    adapters: builtinTools.adapters,
    approvals: stores.approvals,
    policyDecisions: stores.policyDecisions,
    events: stores.events,
    unitOfWork: stores,
  });

  let runtime: ExecutionRuntime;

  const agentToolOrchestration = new AgentToolOrchestrationService({
    agentGateway,
    toolInvocation,
    tools: builtinTools.tools,
    approvals: stores.approvals,
    executions: stores.executions,
    tasks: stores.tasks,
    events: stores.events,
    unitOfWork: stores,
    enqueueExecution: (execution) => runtime.queue.enqueue(execution),
  });

  runtime = createExecutionRuntime({
    runner: new ModelExecutionRunner({
      modelGateway,
      tasks: stores.tasks,
      ...(options.toolPolicy === undefined
        ? {}
        : {
            resumeApprovedToolContinuation: async (executionId) => {
              const result = await agentToolOrchestration.resumeApprovedExecution(
                executionId,
                options.toolPolicy!,
              );
              if (result.status === "NO_CONTINUATION") {
                return { status: "NO_CONTINUATION" as const };
              }
              return {
                status: result.status === "SUCCEEDED"
                  ? "SUCCEEDED" as const
                  : result.status === "APPROVAL_REQUIRED"
                    ? "PAUSED" as const
                    : result.status === "REJECTED"
                      ? "REJECTED" as const
                      : "FAILED" as const,
                ...(result.status === "SUCCEEDED"
                  ? { output: result.response.content }
                  : { error: "Approved tool continuation failed." }),
              };
            },
            toolDefinitions: builtinTools.tools.list()
              .filter((tool) => tool.enabled)
              .map((tool) => ({
                toolId: tool.id,
                name: tool.id.replace(/[^A-Za-z0-9_-]/g, "_") || "polyon_tool",
                description: tool.description,
                ...(tool.inputSchema === undefined
                  ? {}
                  : { inputSchema: tool.inputSchema }),
              })),
            toolOrchestrator: {
              continueFromResponse: async ({ execution, request, response }) => {
                if (execution.agentId === undefined) {
                  return {
                    status: "FAILED" as const,
                    response,
                    error: "Execution requested a tool call without a bound agent.",
                  };
                }

                const result = await agentToolOrchestration.continueFromResponse(
                  {
                    agentId: execution.agentId,
                    requiredCapabilityIds: options.toolRequiredCapabilityIds ?? [],
                    request,
                    response,
                    policy: options.toolPolicy!,
                    actorId: execution.actorId,
                    missionId: execution.missionId,
                    taskId: execution.taskId,
                    executionId: execution.id,
                    maxToolRounds: options.maxToolRounds,
                  },
                  request,
                  response,
                );

                if (result.status === "NO_CONTINUATION") {
                  return {
                    status: "FAILED" as const,
                    response,
                    error: "Tool continuation disappeared before orchestration resumed.",
                  };
                }

                return {
                  status: result.status,
                  response: result.response,
                  ...(result.status === "FAILED" || result.status === "REJECTED"
                    ? { error: result.error }
                    : {}),
                };
              },
            },
          }),
    }),
    executions: stores.executions,
    tasks: stores.tasks,
    approvals: stores.approvals,
    events: stores.events,
    clock: options.clock ?? new SystemClock(),
    executionTimeoutMs: options.executionTimeoutMs,
    pollIntervalMs: options.pollIntervalMs,
    maxConcurrency: options.maxConcurrency,
    retryBackoffInitialMs: options.retryBackoffInitialMs,
    retryBackoffMaxMs: options.retryBackoffMaxMs,
    wait: options.wait,
    onError: options.onError,
    onExecutionCompleted: publishExecutionCompletion,
    unitOfWork: stores,
  });

  const executionDispatch = new ExecutionDispatchService({
    queue: runtime.queue,
    executions: stores.executions,
    approvals: stores.approvals,
    policyDecisions: stores.policyDecisions,
    events: stores.events,
    routing: { agents, models, providers },
    unitOfWork: stores,
  });

  const missionExecution = new MissionExecutionService(
    executionDispatch,
    (task) => stores.tasks.save(task),
    (taskId) => stores.tasks.get(taskId),
    () => stores.executions.list().map((execution) => ({ taskId: execution.taskId, attempt: execution.attempt })),
    stores.events,
  );

  const taskOrchestration = new MissionTaskOrchestrationService({
    tasks: stores.tasks,
    events: stores.events,
    unitOfWork: stores,
    onReadyTasks: options.onReadyTasks,
  });

  executionResults = new ExecutionResultService({
    executions: stores.executions,
    conversations: stores.conversations,
    messages: stores.messages,
    artifacts: stores.artifacts,
    events: stores.events,
    unitOfWork: stores,
    taskOrchestration,
  });

  const executionApproval = new ExecutionApprovalService({
    approvals: stores.approvals,
    executions: stores.executions,
    tasks: stores.tasks,
    queue: runtime.queue,
    events: stores.events,
    unitOfWork: stores,
  });

  const executionRetry = new ExecutionRetryService(stores.tasks, stores.events, missionExecution);

  return {
    stores,
    agents,
    models,
    providers,
    providerAdapters,
    modelGateway,
    agentGateway,
    tools: builtinTools.tools,
    toolAdapters: builtinTools.adapters,
    executionDispatch,
    missionExecution,
    taskOrchestration,
    executionResults,
    executionApproval,
    executionRetry,
    toolInvocation,
    agentToolOrchestration,
    runtime,
  };
}
