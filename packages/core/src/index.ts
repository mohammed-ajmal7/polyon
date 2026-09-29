/**
 * POLYON core domain.
 *
 * This package contains technology-independent domain logic.
 */

export {
  applyApprovedExecutionRun,
  applyApprovedMissionPlanProposal,
  applyMissionPlanProposal,
  areTaskDependenciesSatisfied,
  authorizeExecutionRun,
  authorizeMissionPlanApplication,
  canTransitionExecution,
  cancelExecution,
  completeExecution,
  canTransitionMission,
  canTransitionTask,
  createExecutionForTask,
  createRetryExecution,
  createMissionPlanProposal,
  createMission,
  getReadyTaskIds,
  ApprovedMissionPlanApplicationError,
  ApprovedExecutionRunError,
  ExecutionControlError,
  MissionCreationError,
  rejectExecution,
  ExecutionRetryError,
  retryTask,
  TaskRetryError,
  ExecutionCreationError,
  ExecutionRunAuthorizationError,
  pauseExecution,
  recoverRunningExecution,
  resumeExecution,
  InvalidMissionPlanApplicationError,
  InvalidMissionPlanProposalError,
  InvalidStateTransitionError,
  MissionPlanApplicationDeniedError,
  markTaskReady,
  TaskReadyError,
  startExecution,
  transitionExecutionStatus,
  transitionMissionStatus,
  transitionTaskStatus,
  validateMissionPlanProposal,
  validateMissionTaskPlan,
  validateTaskGraph,
} from "./work/index";

export type { CreateMissionInput, MissionCreationErrorKind, TaskDependency } from "./work/index";

export { createFinding } from "./evidence/finding";
export type { CreateFindingInput } from "./evidence/finding";

export type { CreateApprovalRequestInput, PolicyEvaluationInput } from "./policy/index";

export {
  ApprovalNotRequiredError,
  canTransitionApproval,
  createApprovalRequest,
  evaluatePolicy,
  InvalidApprovalTransitionError,
  transitionApprovalStatus,
} from "./policy/index";
export {
  applyExecutionRunAuthorization,
  ExecutionRunAuthorizationApplicationError,
} from "./work/execution-run-authorization";

export {
  advanceDebatePhase,
  cancelDebate,
  createDebate,
  decideDebate,
  DebateControlError,
  startDebate,
} from "./debate/index";
export { canTransitionDebate } from "./debate/index";
export { DebateValidationError, validateDebateDefinition } from "./debate/index";
