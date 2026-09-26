/**
 * POLYON core domain.
 *
 * This package contains technology-independent domain logic.
 */

export {
  applyApprovedMissionPlanProposal,
  applyMissionPlanProposal,
  areTaskDependenciesSatisfied,
  authorizeExecutionRun,
  authorizeMissionPlanApplication,
  canTransitionExecution,
  canTransitionMission,
  canTransitionTask,
  createExecutionForTask,
  createMissionPlanProposal,
  getReadyTaskIds,
  ApprovedMissionPlanApplicationError,
  ExecutionCreationError,
  ExecutionRunAuthorizationError,
  InvalidMissionPlanApplicationError,
  InvalidMissionPlanProposalError,
  InvalidStateTransitionError,
  MissionPlanApplicationDeniedError,
  transitionExecutionStatus,
  transitionMissionStatus,
  transitionTaskStatus,
  validateMissionPlanProposal,
  validateMissionTaskPlan,
  validateTaskGraph,
} from "./work/index";

export type { CreateApprovalRequestInput, PolicyEvaluationInput } from "./policy/index";

export {
  ApprovalNotRequiredError,
  canTransitionApproval,
  createApprovalRequest,
  evaluatePolicy,
  InvalidApprovalTransitionError,
  transitionApprovalStatus,
} from "./policy/index";
