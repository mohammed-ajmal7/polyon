/**
 * POLYON core domain.
 *
 * This package contains technology-independent domain logic.
 */

export {
  areTaskDependenciesSatisfied,
  canTransitionExecution,
  canTransitionMission,
  canTransitionTask,
  InvalidStateTransitionError,
  transitionExecutionStatus,
  transitionMissionStatus,
  transitionTaskStatus,
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
