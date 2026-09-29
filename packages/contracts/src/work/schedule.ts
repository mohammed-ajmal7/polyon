import type { JobId } from "./job";

export type ScheduleId = string;

export interface Schedule {
  readonly id: ScheduleId;
  readonly userId: string;

  readonly jobType: string;
  readonly payload: unknown;

  readonly intervalSeconds: number;
  readonly nextRunAt: string;
  readonly enabled: boolean;

  readonly lastJobId?: JobId;

  readonly createdAt: string;
  readonly updatedAt: string;
}
