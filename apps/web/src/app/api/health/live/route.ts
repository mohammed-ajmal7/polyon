import { getPolyonComposition } from "@/server/polyon-server";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const runtime = getPolyonComposition().runtime.health;
  return Response.json(
    {
      status: runtime.status === "RUNNING" ? "alive" : "starting",
      runtime,
    },
    { status: runtime.status === "RUNNING" ? 200 : 503 },
  );
}
