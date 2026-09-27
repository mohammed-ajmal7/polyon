import type { Agent, Model, Provider } from "@polyon/contracts";
import { AgentGateway, InMemoryAgentRegistry, InMemoryModelRegistry, InMemoryProviderRegistry } from "@polyon/agents";
import { ExecutionApprovalService, ExecutionDispatchService, ExecutionResultService, ExecutionRetryService, MissionExecutionService, MissionTaskOrchestrationService, type ReadyTaskHandler } from "@polyon/application";
import { InMemoryProviderAdapterRegistry, ModelGateway, type ModelProviderAdapter } from "@polyon/providers";
import { FileDomainStores } from "@polyon/storage";
import { createExecutionRuntime, ModelExecutionRunner, type ExecutionRuntime, type ExecutionRuntimeWait, type ExecutionWorkerClock } from "@polyon/runtime";
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

  if (options.filesystemRoot !== undefined) {
    registerBuiltinTools(builtinTools, {
      filesystemRoot: options.filesystemRoot,
      filesystemReadMaxBytes: options.filesystemReadMaxBytes,
      filesystemReadEnabled: options.filesystemReadEnabled,
    });
  }

  const runtime = createExecutionRuntime({
    runner: new ModelExecutionRunner({ modelGateway, tasks: stores.tasks }),
    executions: stores.executions,
    tasks: stores.tasks,
    events: stores.events,
    clock: options.clock ?? new SystemClock(),
    executionTimeoutMs: options.executionTimeoutMs,
    pollIntervalMs: options.pollIntervalMs,
    maxConcurrency: options.maxConcurrency,
    retryBackoffInitialMs: options.retryBackoffInitialMs,
    retryBackoffMaxMs: options.retryBackoffMaxMs,
    wait: options.wait,
    onError: options.onError,
    onExecutionCompleted: options.onExecutionCompleted,
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

  const executionResults = new ExecutionResultService({
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
    runtime,
  };
}
