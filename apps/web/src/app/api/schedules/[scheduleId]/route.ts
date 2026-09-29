import { isAuthenticated } from "@/server/auth";
import {
  getPolyonActorId,
  getPolyonComposition,
  isSameOrigin,
} from "@/server/polyon-server";

export const runtime = "nodejs";

const MAX_REQUEST_BYTES = 32_768;

export async function GET(
  _request: Request,
  context: { params: Promise<{ scheduleId: string }> },
): Promise<Response> {
  if (!(await isAuthenticated())) {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }

  const { scheduleId } = await context.params;
  const schedule = getPolyonComposition().schedules.get(scheduleId.trim());
  if (schedule === undefined || schedule.userId !== getPolyonActorId()) {
    return Response.json({ error: "Schedule not found." }, { status: 404 });
  }

  return Response.json({ schedule });
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ scheduleId: string }> },
): Promise<Response> {
  if (!(await isAuthenticated())) {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }
  if (!isSameOrigin(request)) {
    return Response.json({ error: "Cross-origin PUT requests are not allowed." }, { status: 403 });
  }

  try {
    const { scheduleId } = await context.params;
    const polyon = getPolyonComposition();
    const current = polyon.schedules.get(scheduleId.trim());
    if (current === undefined || current.userId !== getPolyonActorId()) {
      return Response.json({ error: "Schedule not found." }, { status: 404 });
    }

    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_REQUEST_BYTES) {
      return Response.json({ error: "Schedule request exceeds the 32768-byte limit." }, { status: 413 });
    }

    const input = JSON.parse(raw) as Record<string, unknown>;
    const jobType = input.jobType === undefined ? undefined : readString(input.jobType, "jobType");
    if (jobType !== undefined && polyon.jobHandlers.get(jobType) === undefined) {
      throw new Error("No registered job handler for job type: " + jobType + ".");
    }

    const schedule = polyon.schedules.update(current.id, {
      ...(jobType === undefined ? {} : { jobType }),
      ...(input.payload === undefined ? {} : { payload: input.payload }),
      ...(input.intervalSeconds === undefined
        ? {}
        : { intervalSeconds: readPositiveInteger(input.intervalSeconds, "intervalSeconds") }),
      ...(input.nextRunAt === undefined
        ? {}
        : { nextRunAt: readString(input.nextRunAt, "nextRunAt") }),
      ...(input.enabled === undefined ? {} : { enabled: readBoolean(input.enabled, "enabled") }),
      now: new Date().toISOString(),
    });

    return Response.json({ schedule });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Schedule update failed." },
      { status: 400 },
    );
  }
}

function readString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(field + " must not be empty.");
  }
  return value.trim();
}

function readPositiveInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new Error(field + " must be a positive integer.");
  }
  return value as number;
}

function readBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new Error(field + " must be a boolean.");
  return value;
}
