import type { Execution } from "@polyon/contracts";

export type ExecutionAbortReason = "CANCELLED" | "TIMEOUT";

export interface ExecutionRunContext {
  readonly signal: AbortSignal;
  readonly getAbortReason: () => ExecutionAbortReason | undefined;
}

export type ExecutionRunResult =
  | {
      readonly status: "SUCCEEDED";
      readonly output?: string;
    }
  | {
      readonly status: "PAUSED";
      readonly error: string;
      readonly output?: string;
    }
  | {
      readonly status: "FAILED";
      readonly error: string;
      readonly output?: string;
    }
  | {
      readonly status: "CANCELLED";
      readonly error?: string;
      readonly output?: string;
    };

export interface ExecutionRunner {
  run(execution: Execution, context?: ExecutionRunContext): Promise<ExecutionRunResult>;
}
