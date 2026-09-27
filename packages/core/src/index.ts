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
  getReadyTaskIds,
  ApprovedMissionPlanApplicationError,
  ApprovedExecutionRunError,
  ExecutionControlError,
  rejectExecution,
  ExecutionRetryError,
  ExecutionCreationError,
  ExecutionRunAuthorizationError,
  pauseExecution,
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

export type { TaskDependency } from "./work/task-readiness";

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
export {
  DebateValidationError,
  validateDebateDefinition,
} from "./debate/index";
