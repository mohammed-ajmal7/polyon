import type { Agent, Model, Policy, Provider, SecretReference } from "@polyon/contracts";
import {
  EmailIntegrationAdapter,
  GoogleDriveIntegrationAdapter,
  TelegramIntegrationAdapter,
  InMemoryIntegrationAdapterRegistry,
  type EmailTransport,
  type IntegrationAdapter,
  type SecretResolver,
} from "@polyon/integrations";
import {
  AgentGateway,
  InMemoryAgentRegistry,
  InMemoryModelRegistry,
  InMemoryProviderRegistry,
} from "@polyon/agents";
import {
  ArtifactCatalogService,
  SemanticMemoryService,
  CommandIngressService,
  CodingAgentService,
  ConversationAgentOrchestrationService,
  IntegrationCatalogService,
  IntegrationInvocationService,
  LocalArtifactContentService,
  ExecutionApprovalService,
  ExecutionDispatchService,
  ExecutionResultService,
  AgentToolOrchestrationService,
  MemoryService,
  MissionPlanningService,
  MissionCreationService,
  MissionLifecycleService,
  MissionPlanService,
  MissionPlanOrchestrationService,
  MissionWorkflowService,
  ResearchService,
  ResearchSynthesisService,
  CreativeJobService,
  type CreativeAdapter,
  type ResearchRetriever,
  DebateOrchestrationService,
  ExecutionRetryService,
  MissionExecutionService,
  MissionGraphExecutionService,
  MissionExecutionOrchestrationService,
  MissionTaskOrchestrationService,
  ToolInvocationService,
  registerKnowledgeTools,
  registerCreativeTools,
  type ReadyTaskHandler,
} from "@polyon/application";
import {
  EmbeddingGateway,
  InMemoryEmbeddingAdapterRegistry,
  InMemoryProviderAdapterRegistry,
  ModelGateway,
  type EmbeddingProviderAdapter,
  type ModelProviderAdapter,
} from "@polyon/providers";
import { FileDomainStores } from "@polyon/storage";
import {
  createExecutionRuntime,
  ModelExecutionRunner,
  type ExecutionRunOutcome,
  type ExecutionRuntime,
  type ExecutionRuntimeCompletionHandler,
  type ExecutionRuntimeWait,
  type ExecutionWorkerClock,
} from "@polyon/runtime";
import {
  createInMemoryBuiltinToolRegistries,
  registerBuiltinTools,
  type ToolAdapterRegistry,
  type ToolRegistry,
} from "@polyon/tools";

export interface PolyonProviderRegistration {
  readonly provider: Provider;
  readonly adapter: ModelProviderAdapter;
}

export interface PolyonEmbeddingProviderRegistration {
  readonly provider: Provider;
  readonly model: Model;
  readonly adapter: EmbeddingProviderAdapter;
}

export interface PolyonCompositionOptions {
  readonly storageRoot: string;
  readonly agents?: readonly Agent[];
  readonly models?: readonly Model[];
  readonly providers?: readonly PolyonProviderRegistration[];
  readonly embeddingProvider?: PolyonEmbeddingProviderRegistration;
  readonly integrations?: readonly IntegrationAdapter[];
  readonly secretResolver?: SecretResolver;
  readonly googleDriveIntegrationId?: string;
  readonly googleDriveSecretReference?: SecretReference;
  readonly googleDriveMaxResponseBytes?: number;
  readonly googleDriveDefaultPageSize?: number;
  readonly googleDriveMaxPageSize?: number;
  readonly telegramIntegrationId?: string;
  readonly telegramSecretReference?: SecretReference;
  readonly telegramMaxResponseBytes?: number;
  readonly telegramMaxRequestBytes?: number;
  readonly telegramDefaultTimeoutMs?: number;
  readonly telegramMaxTimeoutMs?: number;
  readonly emailIntegrationId?: string;
  readonly emailSecretReference?: SecretReference;
  readonly emailSmtpUsername?: string;
  readonly emailTransport?: EmailTransport;
  readonly researchRetriever?: ResearchRetriever;
  readonly creativeAdapter?: CreativeAdapter;
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
  readonly gitCommitRoot?: string;
  readonly gitCommitExecutable?: string;
  readonly gitCommitDefaultTimeoutMs?: number;
  readonly gitCommitMaxTimeoutMs?: number;
  readonly gitCommitMaxOutputBytes?: number;
  readonly gitCommitEnvironmentKeys?: readonly string[];
  readonly gitCommitEnabled?: boolean;
  readonly gitPublishRoot?: string;
  readonly gitPublishAllowedRemotes?: readonly string[];
  readonly gitPublishExecutable?: string;
  readonly gitPublishDefaultTimeoutMs?: number;
  readonly gitPublishMaxTimeoutMs?: number;
  readonly gitPublishMaxOutputBytes?: number;
  readonly gitPublishEnvironmentKeys?: readonly string[];
  readonly gitPublishEnabled?: boolean;
  readonly artifactRoot?: string;
  readonly artifactDefaultKind?:
    "DOCUMENT" | "IMAGE" | "VIDEO" | "AUDIO" | "CODE" | "DATASET" | "REPORT" | "OTHER";
  readonly artifactWriteEnabled?: boolean;
  readonly toolPolicy?: Policy;
  readonly toolRequiredCapabilityIds?: readonly string[];
  readonly maxToolRounds?: number;
  readonly maxToolOutputBytes?: number;
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
  readonly commandIngress: CommandIngressService;
  readonly conversationOrchestration: ConversationAgentOrchestrationService;
  readonly missionExecutionOrchestration: MissionExecutionOrchestrationService;
  readonly missionPlanOrchestration: MissionPlanOrchestrationService;
  readonly missionWorkflow: MissionWorkflowService;
  readonly missionGraphExecution: MissionGraphExecutionService;
  readonly missionLifecycle: MissionLifecycleService;
  readonly missionPlan: MissionPlanService;
  readonly stores: FileDomainStores;
  readonly agents: InMemoryAgentRegistry;
  readonly models: InMemoryModelRegistry;
  readonly providers: InMemoryProviderRegistry;
  readonly providerAdapters: InMemoryProviderAdapterRegistry;
  readonly embeddingAdapters: InMemoryEmbeddingAdapterRegistry;
  readonly integrations: InMemoryIntegrationAdapterRegistry;
  readonly secretResolver?: SecretResolver;
  readonly modelGateway: ModelGateway;
  readonly embeddingGateway?: EmbeddingGateway;
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
  readonly integrationInvocation: IntegrationInvocationService;
  readonly integrationCatalog: IntegrationCatalogService;
  readonly artifactCatalog: ArtifactCatalogService;
  readonly localArtifactContent?: LocalArtifactContentService;
  readonly agentToolOrchestration: AgentToolOrchestrationService;
  readonly codingAgent: CodingAgentService;
  readonly memory: MemoryService;
  readonly semanticMemory?: import("./semantic-memory-service").SemanticMemoryService;
  readonly research?: ResearchService;
  readonly researchSynthesis: ResearchSynthesisService;
  readonly creative?: CreativeJobService;
  readonly debates: DebateOrchestrationService;
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
  const embeddingAdapters = new InMemoryEmbeddingAdapterRegistry();
  const integrations = new InMemoryIntegrationAdapterRegistry();

  if (
    options.secretResolver !== undefined &&
    options.googleDriveIntegrationId !== undefined &&
    options.googleDriveSecretReference !== undefined
  ) {
    integrations.register(
      new GoogleDriveIntegrationAdapter({
        integrationId: options.googleDriveIntegrationId,
        secretResolver: options.secretResolver,
        secretReference: options.googleDriveSecretReference,
        ...(options.googleDriveMaxResponseBytes === undefined
          ? {}
          : { maxResponseBytes: options.googleDriveMaxResponseBytes }),
        ...(options.googleDriveDefaultPageSize === undefined
          ? {}
          : { defaultPageSize: options.googleDriveDefaultPageSize }),
        ...(options.googleDriveMaxPageSize === undefined
          ? {}
          : { maxPageSize: options.googleDriveMaxPageSize }),
      }),
    );
  }

  if (
    options.secretResolver !== undefined &&
    options.telegramIntegrationId !== undefined &&
    options.telegramSecretReference !== undefined
  ) {
    integrations.register(
      new TelegramIntegrationAdapter({
        integrationId: options.telegramIntegrationId,
        secretResolver: options.secretResolver,
        secretReference: options.telegramSecretReference,
        ...(options.telegramMaxResponseBytes === undefined
          ? {}
          : { maxResponseBytes: options.telegramMaxResponseBytes }),
        ...(options.telegramMaxRequestBytes === undefined
          ? {}
          : { maxRequestBytes: options.telegramMaxRequestBytes }),
        ...(options.telegramDefaultTimeoutMs === undefined
          ? {}
          : { defaultTimeoutMs: options.telegramDefaultTimeoutMs }),
        ...(options.telegramMaxTimeoutMs === undefined
          ? {}
          : { maxTimeoutMs: options.telegramMaxTimeoutMs }),
      }),
    );
  }

  if (
    options.secretResolver !== undefined &&
    options.emailIntegrationId !== undefined &&
    options.emailSecretReference !== undefined &&
    options.emailSmtpUsername !== undefined &&
    options.emailTransport !== undefined
  ) {
    integrations.register(
      new EmailIntegrationAdapter({
        integrationId: options.emailIntegrationId,
        secretResolver: options.secretResolver,
        secretReference: options.emailSecretReference,
        smtpUsername: options.emailSmtpUsername,
        transport: options.emailTransport,
      }),
    );
  }

  for (const agent of options.agents ?? []) agents.register(agent);
  for (const model of options.models ?? []) models.register(model);
  for (const registration of options.providers ?? []) {
    providers.register(registration.provider);
    providerAdapters.register(registration.adapter);
  }

  if (options.embeddingProvider !== undefined) {
    providers.register(options.embeddingProvider.provider);
    models.register(options.embeddingProvider.model);
    embeddingAdapters.register(options.embeddingProvider.adapter);
  }

  for (const integration of options.integrations ?? []) {
    integrations.register(integration);
  }

  const modelGateway = new ModelGateway({ models, providers, adapters: providerAdapters });
  const embeddingGateway =
    options.embeddingProvider === undefined
      ? undefined
      : new EmbeddingGateway({ models, providers, adapters: embeddingAdapters });
  const agentGateway = new AgentGateway({ agents, models, providers, modelGateway });

  const commandIngress = new CommandIngressService({
    conversations: stores.conversations,
    messages: stores.messages,
    events: stores.events,
    unitOfWork: stores,
  });

  const memory = new MemoryService(stores.memory, stores.events, stores);
  const semanticMemory =
    embeddingGateway === undefined
      ? undefined
      : new SemanticMemoryService(
          stores.memory,
          stores.memoryEmbeddings,
          embeddingGateway,
          stores,
        );
  const debates = new DebateOrchestrationService(agentGateway, stores.debates, stores.events, stores);
  const research =
    options.researchRetriever === undefined
      ? undefined
      : new ResearchService(
          options.researchRetriever,
          stores.sources,
          stores.evidence,
          stores.events,
          stores,
        );
  const researchSynthesis = new ResearchSynthesisService(
    agentGateway,
    stores.sources,
    stores.evidence,
    stores.memory,
    stores.events,
    stores,
  );
  const creative =
    options.creativeAdapter === undefined
      ? undefined
      : new CreativeJobService(
          options.creativeAdapter,
          stores.artifacts,
          stores.events,
          stores,
        );

  const builtinTools = createInMemoryBuiltinToolRegistries();

  if (
    options.filesystemRoot !== undefined ||
    (options.terminalRoot !== undefined && options.terminalAllowedCommands !== undefined) ||
    options.gitRoot !== undefined ||
    options.gitWriteRoot !== undefined ||
    options.gitCommitRoot !== undefined ||
    (options.gitPublishRoot !== undefined && options.gitPublishAllowedRemotes !== undefined) ||
    options.artifactRoot !== undefined
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
      gitCommitRoot: options.gitCommitRoot,
      gitCommitExecutable: options.gitCommitExecutable,
      gitCommitDefaultTimeoutMs: options.gitCommitDefaultTimeoutMs,
      gitCommitMaxTimeoutMs: options.gitCommitMaxTimeoutMs,
      gitCommitMaxOutputBytes: options.gitCommitMaxOutputBytes,
      gitCommitEnvironmentKeys: options.gitCommitEnvironmentKeys,
      gitCommitEnabled: options.gitCommitEnabled,
      gitPublishRoot: options.gitPublishRoot,
      gitPublishAllowedRemotes: options.gitPublishAllowedRemotes,
      gitPublishExecutable: options.gitPublishExecutable,
      gitPublishDefaultTimeoutMs: options.gitPublishDefaultTimeoutMs,
      gitPublishMaxTimeoutMs: options.gitPublishMaxTimeoutMs,
      gitPublishMaxOutputBytes: options.gitPublishMaxOutputBytes,
      gitPublishEnvironmentKeys: options.gitPublishEnvironmentKeys,
      gitPublishEnabled: options.gitPublishEnabled,
      artifactRoot: options.artifactRoot,
      artifactDefaultKind: options.artifactDefaultKind,
      artifactWriteEnabled: options.artifactWriteEnabled,
    });
  }

  let executionResults: ExecutionResultService | undefined;

  const publishExecutionCompletion = async (outcome: ExecutionRunOutcome): Promise<void> => {
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
            ? (outcome.result.output ?? "")
            : (outcome.result.error ?? "Execution did not produce a result.");

        executionResults.persist({
          executionId: outcome.execution.id,
          conversationId: conversation.id,
          messageId: `execution-result:${outcome.execution.id}`,
          actorId: outcome.execution.actorId,
          output,
          createdAt: outcome.execution.completedAt ?? outcome.execution.updatedAt,
        });
      }
    }

    await externalHandler?.(outcome);
  };

  const artifactCatalog = new ArtifactCatalogService({
    artifacts: stores.artifacts,
  });

  const localArtifactContent =
    options.artifactRoot === undefined
      ? undefined
      : new LocalArtifactContentService({
          artifacts: stores.artifacts,
          options: {
            rootDir: options.artifactRoot,
          },
        });

  registerKnowledgeTools(builtinTools.tools, builtinTools.adapters, memory, research);
  if (creative !== undefined) registerCreativeTools(builtinTools.tools, builtinTools.adapters, creative);

  registerBuiltinTools(builtinTools, {
    artifactList: (filter) => artifactCatalog.list(filter),
    ...(localArtifactContent === undefined
      ? {}
      : {
          artifactRead: (artifactId, maxBytes) => localArtifactContent.read(artifactId, maxBytes),
        }),
  });

  const integrationCatalog = new IntegrationCatalogService(integrations);

  const integrationInvocation = new IntegrationInvocationService({
    integrations,
    approvals: stores.approvals,
    policyDecisions: stores.policyDecisions,
    events: stores.events,
    unitOfWork: stores,
  });

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
    integrationInvocation,
    integrations,
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
                options.maxToolOutputBytes,
              );
              if (result.status === "NO_CONTINUATION") {
                return { status: "NO_CONTINUATION" as const };
              }
              return {
                status:
                  result.status === "SUCCEEDED"
                    ? ("SUCCEEDED" as const)
                    : result.status === "APPROVAL_REQUIRED"
                      ? ("PAUSED" as const)
                      : result.status === "REJECTED"
                        ? ("REJECTED" as const)
                        : ("FAILED" as const),
                ...(result.status === "SUCCEEDED"
                  ? { output: result.response.content }
                  : { error: "Approved tool continuation failed." }),
              };
            },
            toolDefinitions: agentToolOrchestration.modelToolDefinitions(),
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
                    policy: options.toolPolicy!,
                    actorId: execution.actorId,
                    missionId: execution.missionId,
                    taskId: execution.taskId,
                    executionId: execution.id,
                    maxToolRounds: options.maxToolRounds,
                    maxToolOutputBytes: options.maxToolOutputBytes,
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
    () =>
      stores.executions
        .list()
        .map((execution) => ({ taskId: execution.taskId, attempt: execution.attempt })),
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

  const missionLifecycle = new MissionLifecycleService({
    missions: stores.missions,
    tasks: stores.tasks,
    events: stores.events,
    unitOfWork: stores,
  });

  const missionPlanService = new MissionPlanService({
    missions: stores.missions,
    tasks: stores.tasks,
    proposals: stores.missionPlanProposals,
    policyDecisions: stores.policyDecisions,
    approvals: stores.approvals,
    events: stores.events,
    unitOfWork: stores,
  });

  const missionPlanOrchestration = new MissionPlanOrchestrationService(
    stores.missions,
    new MissionPlanningService(agentGateway, stores.tasks, stores.events, stores),
    missionPlanService,
    taskOrchestration,
    stores,
  );

  const missionGraphExecution = new MissionGraphExecutionService(
    stores.missions,
    stores.tasks,
    missionExecution,
  );

  const missionWorkflow = new MissionWorkflowService(
    new MissionCreationService({
      conversations: stores.conversations,
      missions: stores.missions,
      events: stores.events,
      unitOfWork: stores,
    }),
    missionLifecycle,
    missionPlanOrchestration,
    missionGraphExecution,
  );
  const executionRetry = new ExecutionRetryService(stores.tasks, stores.events, missionExecution);
  const codingAgent = new CodingAgentService(agentToolOrchestration);
  const conversationOrchestration = new ConversationAgentOrchestrationService(
    agentToolOrchestration,
    stores.conversations,
    stores.messages,
    stores.events,
    stores,
  );

  const missionExecutionOrchestration = new MissionExecutionOrchestrationService(
    new MissionCreationService({
      conversations: stores.conversations,
      missions: stores.missions,
      events: stores.events,
      unitOfWork: stores,
    }),
    new MissionLifecycleService({
      missions: stores.missions,
      tasks: stores.tasks,
      events: stores.events,
      unitOfWork: stores,
    }),
    new MissionPlanService({
      missions: stores.missions,
      tasks: stores.tasks,
      proposals: stores.missionPlanProposals,
      policyDecisions: stores.policyDecisions,
      approvals: stores.approvals,
      events: stores.events,
      unitOfWork: stores,
    }),
    missionExecution,
    stores.tasks,
  );



  return {
    commandIngress,
    conversationOrchestration,
    missionExecutionOrchestration,
    missionPlanOrchestration,
    missionWorkflow,
    missionGraphExecution,
    missionLifecycle,
    missionPlan: missionPlanService,
    stores,
    agents,
    models,
    providers,
    providerAdapters,
    integrations,
    ...(options.secretResolver === undefined ? {} : { secretResolver: options.secretResolver }),
    modelGateway,
    ...(embeddingGateway === undefined ? {} : { embeddingGateway }),
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
    integrationInvocation,
    integrationCatalog,
    artifactCatalog,
    ...(localArtifactContent === undefined ? {} : { localArtifactContent }),
    agentToolOrchestration,
    codingAgent,
    memory,
    ...(semanticMemory === undefined ? {} : { semanticMemory }),
    ...(research === undefined ? {} : { research }),
    researchSynthesis,
    ...(creative === undefined ? {} : { creative }),
    debates,
    runtime,
  };
}
