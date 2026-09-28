export type { IntegrationSideEffectClass } from "./integration/side-effect-class";

export type { Actor, ActorId, ActorKind, ActorStatus } from "./actor/index";

export type {
  Agent,
  AgentId,
  AgentStatus,
  Capability,
  CapabilityId,
  CapabilityKind,
  Model,
  ModelId,
  ModelKind,
  ModelMessage,
  ModelMessageRole,
  ModelToolCall,
  ModelToolDefinition,
  Provider,
  ProviderId,
  ProviderKind,
  TextModelFinishReason,
  TextModelRequest,
  TextModelResponse,
  TextModelUsage,
  EmbeddingRequest,
  EmbeddingResponse,
} from "./agent/index";

export type { DomainEvent, EventId, EventKind } from "./observability/index";

export type {
  ActionKind,
  ApprovalMode,
  ApprovalRequest,
  ApprovalRequestId,
  ApprovalStatus,
  Policy,
  PolicyDecision,
  PolicyDecisionId,
  PolicyEffect,
  PolicyId,
  PolicyRule,
  RiskLevel,
} from "./policy/index";

export type { Tool, ToolId, ToolInputSchema, ToolKind } from "./tool/index";

export type {
  Artifact,
  ArtifactId,
  ArtifactKind,
  ArtifactStatus,
  Evidence,
  EvidenceId,
  EvidenceKind,
  Source,
  SourceId,
  SourceKind,
} from "./evidence/index";

export type {
  Execution,
  ExecutionId,
  ExecutionStatus,
  Mission,
  MissionId,
  MissionStatus,
  Task,
  TaskId,
  TaskKind,
  TaskStatus,
} from "./work/index";

export type {
  Conversation,
  ConversationId,
  ConversationKind,
  ConversationStatus,
  Message,
  MessageId,
  MessageKind,
  MessageRole,
} from "./communication/index";

export type { Debate, DebateId, DebatePhase, DebateStatus } from "./debate/index";

export type { MissionPlanProposal } from "./work/mission-plan-proposal";
export type { MissionPlanProposalId } from "./work/ids";

export type { SecretReference, SecretReferenceId, SecretReferenceKind } from "./security/index";
export type { MemoryEmbedding, MemoryEntry, MemoryId, MemoryKind, MemoryScope } from "./memory/index";

export type { InteroperabilityAdapter, InteroperabilityEnvelope, InteroperabilityProtocol } from "./interoperability/index";
export { validateInteroperabilityEnvelope } from "./interoperability/index";

export { JsonInteroperabilityAdapter } from "./interoperability/index";
