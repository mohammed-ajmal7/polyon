export type ExecutionRunResult =
  | {
      readonly status: "SUCCEEDED";
      readonly output?: string;
    }
  | {
      readonly status: "FAILED";
      readonly error: string;
      readonly output?: string;
    };

export interface ExecutionRunner {
  run(execution: import("@polyon/contracts").Execution): Promise<ExecutionRunResult>;
}
