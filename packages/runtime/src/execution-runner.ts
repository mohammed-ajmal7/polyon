import type { Execution } from "@polyon/contracts";

export interface ExecutionRunResult {
  readonly status: "SUCCEEDED" | "FAILED";
  readonly error?: string;
}

export interface ExecutionRunner {
  run(execution: Execution): Promise<ExecutionRunResult>;
}
