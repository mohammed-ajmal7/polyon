import { isAuthenticated } from "@/server/auth";
import { getPolyonComposition } from "@/server/polyon-server";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ missionId: string }>;
}

export async function GET(
  _request: Request,
  context: RouteContext,
): Promise<Response> {
  if (!(await isAuthenticated())) {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }

  const { missionId } = await context.params;
  const polyon = getPolyonComposition();
  const mission = polyon.stores.missions.get(missionId);

  if (mission === undefined) {
    return Response.json({ error: "Mission not found." }, { status: 404 });
  }

  const tasks = mission.taskIds
    .map((taskId) => polyon.stores.tasks.get(taskId))
    .filter((task): task is NonNullable<typeof task> => task !== undefined);

  const executions = polyon.stores.executions
    .list()
    .filter((execution) => execution.missionId === mission.id);

  return Response.json({ mission, tasks, executions });
}
