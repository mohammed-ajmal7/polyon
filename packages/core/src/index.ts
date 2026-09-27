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
  completeExecution,
  canTransitionMission,
  canTransitionTask,
  createExecutionForTask,
  createRetryExecution,
  createMissionPlanProposal,
  getReadyTaskIds,
  ApprovedMissionPlanApplicationError,
  ApprovedExecutionRunError,
  ExecutionRunAuthorizationApplicationError,
  ExecutionControlError,
  ExecutionRetryError,
  ExecutionCreationError,
  ExecutionRunAuthorizationError,
  InvalidMissionPlanApplicationError,
  InvalidMissionPlanProposalError,
  InvalidStateTransitionError,
  MissionPlanApplicationDeniedError,
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
