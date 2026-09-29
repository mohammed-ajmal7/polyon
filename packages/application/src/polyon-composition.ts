import type {
  Agent,
  MemoryScope,
  Model,
  Policy,
  Provider,
  SecretReference,
} from "@polyon/contracts";
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
  planAgentTeam,
  ProviderHealthTracker,
} from "@polyon/agents";
import {
  ArtifactCatalogService,
  A2APushNotificationService,
  createDurableA2APushNotificationStore,
  createA2AWebhookSender,
  SemanticMemoryService,
  createSemanticMemoryIndexer,
  ExactNormalizedSemanticVectorIndex,
  type SemanticMemoryIndexer,
  CommandIngressService,
  CodingAgentService,
  ConversationAgentOrchestrationService,
  CollectiveOrchestrationService,
  DeepAnalysisOrchestrationService,
  IntegrationCatalogService,
  IntegrationInvocationService,
  LocalArtifactContentService,
  ExecutionApprovalService,
  ExecutionDispatchService,
  ExecutionResultService,
  AgentToolOrchestrationService,
  AgentMessageService,
  AgentRunService,
  MemoryService,
  MissionPlanningService,
  MissionCreationService,
  MissionLifecycleService,
  MissionPlanService,
  MissionPlanOrchestrationService,
  MissionWorkflowService,
  ResearchOrchestrationService,
  ResearchService,
  ResearchSynthesisService,
  CreativeJobService,
  type CreativeAdapter,
  type ResearchRetriever,
  type ResearchFabricProvider,
  ResearchFabric,
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
  UsageGovernor,
  type EmbeddingProviderAdapter,
  type ModelInvocationTelemetryRecord,
  type ModelProviderAdapter,
} from "@polyon/providers";
import { FileDomainStores } from "@polyon/storage";
import {
  createExecutionRuntime,
  createJobRuntime,
  JobService,
  ModelExecutionRunner,
  type ExecutionRunOutcome,
  type ExecutionRuntime,
  type ExecutionRuntimeCompletionHandler,
  type ExecutionRuntimeWait,
  type ExecutionWorkerClock,
  type JobHandlers,
  type JobRuntime,
  type JobRuntimeWait,
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
  readonly usageGovernor?: UsageGovernor;
  readonly embeddingProvider?: PolyonEmbeddingProviderRegistration;
  readonly semanticMemoryIndexingEnabled?: boolean;
  readonly semanticMemoryIndexIntervalMs?: number;
  readonly semanticMemoryIndexBatchSize?: number;
  readonly semanticMemoryIndexMaxEntries?: number;
  readonly semanticMemoryIndexAllowedScopes?: readonly MemoryScope[];
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
  readonly researchFabricProviders?: readonly ResearchFabricProvider[];
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
  readonly a2aPushNotificationAllowedOrigins?: readonly string[];
  readonly onReadyTasks?: ReadyTaskHandler;
  readonly jobHandlers?: JobHandlers;
  readonly jobPollIntervalMs?: number;
  readonly jobMaxConcurrency?: number;
  readonly jobRetryBackoffInitialMs?: number;
  readonly jobRetryBackoffMaxMs?: number;
  readonly jobWait?: JobRuntimeWait;
  readonly onJobError?: (error: unknown) => void;
  readonly onJobCompleted?: (
    job: import("@polyon/contracts").Job,
  ) => void | Promise<void>;
}

export interface PolyonComposition {
  readonly commandIngress: CommandIngressService;
  readonly conversationOrchestration: ConversationAgentOrchestrationService;
  readonly collectiveOrchestration: CollectiveOrchestrationService;
  readonly deepAnalysisOrchestration: DeepAnalysisOrchestrationService;
  readonly researchOrchestration?: ResearchOrchestrationService;
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
  readonly usageGovernor?: UsageGovernor;
  readonly embeddingAdapters: InMemoryEmbeddingAdapterRegistry;
  readonly integrations: InMemoryIntegrationAdapterRegistry;
  readonly secretResolver?: SecretResolver;
  readonly modelGateway: ModelGateway;
  readonly embeddingGateway?: EmbeddingGateway;
  readonly agentGateway: AgentGateway;
  readonly providerHealth: ProviderHealthTracker;
  readonly tools: ToolRegistry;
  readonly toolAdapters: ToolAdapterRegistry;
  readonly executionDispatch: ExecutionDispatchService;
  readonly missionExecution: MissionExecutionService;
  readonly taskOrchestration: MissionTaskOrchestrationService;
  readonly executionResults: ExecutionResultService;
  readonly executionApproval: ExecutionApprovalService;
  readonly executionRetry: ExecutionRetryService;
  readonly toolInvocation: ToolInvocationService;
  readonly agentMessages: AgentMessageService;
  readonly agentRuns: AgentRunService;
  readonly integrationInvocation: IntegrationInvocationService;
  readonly integrationCatalog: IntegrationCatalogService;
  readonly artifactCatalog: ArtifactCatalogService;
  readonly localArtifactContent?: LocalArtifactContentService;
  readonly agentToolOrchestration: AgentToolOrchestrationService;
  readonly codingAgent: CodingAgentService;
  readonly memory: MemoryService;
  readonly semanticMemory?: SemanticMemoryService;
  readonly semanticMemoryIndexer?: SemanticMemoryIndexer;
  readonly research?: ResearchService;
  readonly researchFabric: ResearchFabric;
  readonly researchSynthesis: ResearchSynthesisService;
  readonly creative?: CreativeJobService;
  readonly debates: DebateOrchestrationService;
  readonly runtime: ExecutionRuntime;
  readonly jobService: JobService;
  readonly jobRuntime: JobRuntime;
  readonly a2aPushNotifications?: A2APushNotificationService;
}

class SystemClock implements ExecutionWorkerClock {
  now(): string {
    return new Date().toISOString();
  }
}

export function createPolyonComposition(options: PolyonCompositionOptions): PolyonComposition {
  const stores = new FileDomainStores(options.storageRoot);
  const jobService = new JobService({
    jobs: stores.jobs,
    events: stores.events,
    unitOfWork: stores,
  });
  const agents = new InMemoryAgentRegistry();
  const models = new InMemoryModelRegistry();
  const providers = new InMemoryProviderRegistry();
  const providerAdapters = new InMemoryProviderAdapterRegistry();
  const embeddingAdapters = new InMemoryEmbeddingAdapterRegistry();
  const integrations = new InMemoryIntegrationAdapterRegistry();
  const a2aPushNotifications =
    options.a2aPushNotificationAllowedOrigins !== undefined &&
    options.a2aPushNotificationAllowedOrigins.length > 0
      ? new A2APushNotificationService({
          store: createDurableA2APushNotificationStore(stores.a2aPushNotificationConfigs),
          ownerId: "a2a-client",
          sender: createA2AWebhookSender({
            allowedOrigins: options.a2aPushNotificationAllowedOrigins,
          }),
          validateTask: (taskId) => {
            const task = stores.tasks.get(taskId);
            return (
              task !== undefined &&
              stores.executions
                .list()
                .some((execution) => execution.taskId === taskId && execution.actorId === "a2a-client")
            );
          },
        })
      : undefined;

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

  const providerHealth = new ProviderHealthTracker();

  const modelGateway = new ModelGateway({
    models,
    providers,
    adapters: providerAdapters,
    ...(options.usageGovernor === undefined ? {} : { usageGovernor: options.usageGovernor }),
    telemetry: {
      record: (record: ModelInvocationTelemetryRecord) => {
        stores.events.append({
          id:
            "MODEL_INVOCATION_RECORDED:" +
            record.providerId +
            ":" +
            record.modelId +
            ":" +
            (record.runId ?? "no-run") +
            ":" +
            (record.agentId ?? "no-agent") +
            ":" +
            record.attempt +
            ":" +
            record.recordedAt,
          kind: "MODEL_INVOCATION_RECORDED",
          agentRunId: record.runId,
          occurredAt: record.recordedAt,
          data: {
            providerId: record.providerId,
            modelId: record.modelId,
            agentId: record.agentId,
            attempt: record.attempt,
            status: record.status,
            estimatedTokens: record.estimatedTokens,
            actualTokens: record.actualTokens,
            latencyMs: record.latencyMs,
            costClass: record.costClass,
            errorKind: record.errorKind,
          },
        });
      },
    },
  });
  const embeddingGateway =
    options.embeddingProvider === undefined
      ? undefined
      : new EmbeddingGateway({ models, providers, adapters: embeddingAdapters });
  const agentGateway = new AgentGateway({
    agents,
    models,
    providers,
    modelGateway,
    providerHealth,
  });

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
      : new SemanticMemoryService(stores.memory, stores.memoryEmbeddings, embeddingGateway, stores);
  const semanticMemoryIndexer =
    semanticMemory === undefined ||
    embeddingGateway === undefined ||
    options.semanticMemoryIndexingEnabled !== true ||
    (options.semanticMemoryIndexAllowedScopes?.length ?? 0) === 0
      ? undefined
      : createSemanticMemoryIndexer(semanticMemory, options.embeddingProvider!.model.id, {
          ...(options.semanticMemoryIndexIntervalMs === undefined
            ? {}
            : { intervalMs: options.semanticMemoryIndexIntervalMs }),
          ...(options.semanticMemoryIndexBatchSize === undefined
            ? {}
            : { batchSize: options.semanticMemoryIndexBatchSize }),
          ...(options.semanticMemoryIndexMaxEntries === undefined
            ? {}
            : { maxEntries: options.semanticMemoryIndexMaxEntries }),
          allowedScopes: options.semanticMemoryIndexAllowedScopes,
        });
  const debates = new DebateOrchestrationService(
    agentGateway,
    stores.debates,
    stores.events,
    stores,
    agents,
  );
  const researchFabric = new ResearchFabric();
  for (const provider of options.researchFabricProviders ?? []) {
    researchFabric.register(provider);
  }

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
      : new CreativeJobService(options.creativeAdapter, stores.artifacts, stores.events, stores);

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

  if (a2aPushNotifications !== undefined) {
    stores.subscribeCommittedEvents((event) => {
      if (event.kind !== "TASK_STATUS_CHANGED" || event.taskId === undefined) {
        return;
      }
      const task = stores.tasks.get(event.taskId);
      if (task !== undefined) {
        void a2aPushNotifications.notifyTask(task);
      }
    });
  }

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
  if (creative !== undefined)
    registerCreativeTools(builtinTools.tools, builtinTools.adapters, creative);

  registerBuiltinTools(builtinTools, {
    artifactList: (filter) => artifactCatalog.list(filter),
    ...(localArtifactContent === undefined
      ? {}
      : {
          artifactRead: (artifactId, maxBytes) => localArtifactContent.read(artifactId, maxBytes),
        }),
  });

  const integrationCatalog = new IntegrationCatalogService(integrations);

  const agentMessages = new AgentMessageService({
    conversations: stores.conversations,
    messages: stores.messages,
    events: stores.events,
    unitOfWork: stores,
  });

  const agentRuns = new AgentRunService({
    agentRuns: stores.agentRuns,
    messages: stores.messages,
    events: stores.events,
    conversations: stores.conversations,
    unitOfWork: stores,
  });

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
    agentMessages,
    agentRuns,
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

  const jobRuntime = createJobRuntime({
    jobs: jobService,
    ...(options.jobHandlers === undefined ? {} : { handlers: options.jobHandlers }),
    clock: options.clock ?? new SystemClock(),
    ...(options.jobPollIntervalMs === undefined
      ? {}
      : { pollIntervalMs: options.jobPollIntervalMs }),
    ...(options.jobMaxConcurrency === undefined
      ? {}
      : { maxConcurrency: options.jobMaxConcurrency }),
    ...(options.jobRetryBackoffInitialMs === undefined
      ? {}
      : { retryBackoffInitialMs: options.jobRetryBackoffInitialMs }),
    ...(options.jobRetryBackoffMaxMs === undefined
      ? {}
      : { retryBackoffMaxMs: options.jobRetryBackoffMaxMs }),
    ...(options.jobWait === undefined ? {} : { wait: options.jobWait }),
    ...(options.onJobError === undefined ? {} : { onError: options.onJobError }),
    ...(options.onJobCompleted === undefined
      ? {}
      : { onJobCompleted: options.onJobCompleted }),
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

  const collectiveOrchestration = new CollectiveOrchestrationService({
    agents,
    agentGateway,
    conversations: stores.conversations,
    messages: stores.messages,
    events: stores.events,
    ...(research === undefined ? {} : { research }),
    agentRuns,
    teamPlanner: (request) =>
      planAgentTeam(request, {
        agents,
        models,
        providers,
      }),
    unitOfWork: stores,
  });

  const deepAnalysisOrchestration = new DeepAnalysisOrchestrationService({
    collective: collectiveOrchestration,
    debates,
    agents,
    conversations: stores.conversations,
    messages: stores.messages,
    events: stores.events,
    unitOfWork: stores,
  });

  const researchOrchestration =
    research === undefined
      ? undefined
      : new ResearchOrchestrationService({
          agents,
          agentGateway,
          research,
          conversations: stores.conversations,
          messages: stores.messages,
          events: stores.events,
          unitOfWork: stores,
        });

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
    collectiveOrchestration,
    deepAnalysisOrchestration,
    ...(researchOrchestration === undefined ? {} : { researchOrchestration }),
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
    ...(options.usageGovernor === undefined ? {} : { usageGovernor: options.usageGovernor }),
    embeddingAdapters,
    integrations,
    ...(options.secretResolver === undefined ? {} : { secretResolver: options.secretResolver }),
    modelGateway,
    ...(embeddingGateway === undefined ? {} : { embeddingGateway }),
    agentGateway,
    providerHealth,
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
    ...(semanticMemoryIndexer === undefined ? {} : { semanticMemoryIndexer }),
    ...(research === undefined ? {} : { research }),
    researchFabric,
    researchSynthesis,
    ...(creative === undefined ? {} : { creative }),
    debates,
    runtime,
    jobService,
    jobRuntime,
    ...(a2aPushNotifications === undefined ? {} : { a2aPushNotifications }),
  };
}
