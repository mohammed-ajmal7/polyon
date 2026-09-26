/**
 * POLYON core domain.
 *
 * This package contains technology-independent domain logic.
 */

export {
  applyMissionPlanProposal,
  areTaskDependenciesSatisfied,
  authorizeMissionPlanApplication,
  canTransitionExecution,
  canTransitionMission,
  canTransitionTask,
  createMissionPlanProposal,
  getReadyTaskIds,
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
