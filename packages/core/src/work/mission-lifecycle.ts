import type { MissionStatus } from "@polyon/contracts";

const transitions: Readonly<Record<MissionStatus, readonly MissionStatus[]>> = {
  DRAFT: ["PLANNING", "CANCELLED"],
  PLANNING: ["WAITING", "RUNNING", "CANCELLED"],
  WAITING: ["PLANNING", "RUNNING", "CANCELLED"],
  RUNNING: ["WAITING", "PAUSED", "SUCCEEDED", "FAILED", "CANCELLED"],
  PAUSED: ["RUNNING", "WAITING", "CANCELLED"],
  SUCCEEDED: [],
  FAILED: [],
  CANCELLED: [],
};

export function canTransitionMission(from: MissionStatus, to: MissionStatus): boolean {
  return transitions[from].includes(to);
}
