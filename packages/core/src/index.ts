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
