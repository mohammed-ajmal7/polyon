import { isAuthenticated } from "@/server/auth";
import {
  getPolyonActorId,
  getPolyonComposition,
  isSameOrigin,
} from "@/server/polyon-server";

export const runtime = "nodejs";

const MAX_REQUEST_BYTES = 32_768;

export async function GET(): Promise<Response> {
  if (!(await isAuthenticated())) {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }

  const schedules = getPolyonComposition().schedules.listByUser(getPolyonActorId());
  return Response.json({ schedules });
}

export async function POST(request: Request): Promise<Response> {
  if (!(await isAuthenticated())) {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }
  if (!isSameOrigin(request)) {
    return Response.json({ error: "Cross-origin POST requests are not allowed." }, { status: 403 });
  }

  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_REQUEST_BYTES) {
      return Response.json({ error: "Schedule request exceeds the 32768-byte limit." }, { status: 413 });
    }

    const input = JSON.parse(raw) as Record<string, unknown>;
    const userId = getPolyonActorId();
    const jobType = readString(input.jobType, "jobType");
    const polyon = getPolyonComposition();

    if (polyon.jobHandlers.get(jobType) === undefined) {
      throw new Error("No registered job handler for job type: " + jobType + ".");
    }

    const schedule = polyon.schedules.create({
      ...(typeof input.id === "string" && input.id.trim() !== "" ? { id: input.id.trim() } : {}),
      userId,
      jobType,
      payload: input.payload ?? null,
      intervalSeconds: readPositiveInteger(input.intervalSeconds, "intervalSeconds"),
      nextRunAt: readString(input.nextRunAt, "nextRunAt"),
    });

    return Response.json({ schedule }, { status: 201 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Schedule creation failed." },
      { status: 400 },
    );
  }
}

function readString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(field + " is required.");
  }
  return value.trim();
}

function readPositiveInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new Error(field + " must be a positive integer.");
  }
  return value as number;
}
