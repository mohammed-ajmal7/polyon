import {
  getPersistentBackgroundRun,
  updatePersistentBackgroundRun,
} from "@/server/run-registry";
import { executePolyonTask, type ExecuteTaskInput } from "@/server/execute-task";

export async function polyonExecutionWorkflow(input: ExecuteTaskInput): Promise<unknown> {
  "use workflow";

  return executePolyonExecutionStep(input);
}

async function executePolyonExecutionStep(input: ExecuteTaskInput): Promise<unknown> {
  "use step";

  const existing = await getPersistentBackgroundRun(input.runId);
  const startedAt = existing?.startedAt ?? new Date().toISOString();

  try {
    const result = await executePolyonTask(input);

    await updatePersistentBackgroundRun({
      runId: input.runId,
      mode: input.mode,
      ...(input.modeReason === undefined ? {} : { modeReason: input.modeReason }),
      startedAt,
      status: "succeeded",
      finishedAt: new Date().toISOString(),
      result,
    });

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "The request failed.";

    try {
      await updatePersistentBackgroundRun({
        runId: input.runId,
        mode: input.mode,
        ...(input.modeReason === undefined ? {} : { modeReason: input.modeReason }),
        startedAt,
        status: "failed",
        finishedAt: new Date().toISOString(),
        error: message,
      });
    } catch {
      // The workflow error remains the source of truth if the application status write fails.
    }

    throw error;
  }
}

