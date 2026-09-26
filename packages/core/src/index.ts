/**
 * POLYON core domain.
 *
 * This package contains technology-independent domain logic.
 */

export {
  canTransitionExecution,
  canTransitionMission,
  canTransitionTask,
  InvalidStateTransitionError,
  transitionExecutionStatus,
  transitionMissionStatus,
  transitionTaskStatus,
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
