export type ExecutionRunResult =
  | {
      readonly status: "SUCCEEDED";
    }
  | {
      readonly status: "FAILED";
      readonly error: string;
    };

export interface ExecutionRunner {
  run(execution: import("@polyon/contracts").Execution): Promise<ExecutionRunResult>;
}
