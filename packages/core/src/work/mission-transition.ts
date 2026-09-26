import type { Mission } from "@polyon/contracts";

import { canTransitionMission } from "./mission-lifecycle";
import { InvalidStateTransitionError } from "./transition-error";

export function transitionMissionStatus(
  mission: Mission,
  to: Mission["status"],
  now: string,
): Mission {
  if (!canTransitionMission(mission.status, to)) {
    throw new InvalidStateTransitionError("mission", mission.status, to);
  }

  return {
    ...mission,
    status: to,
    updatedAt: now,
  };
}
