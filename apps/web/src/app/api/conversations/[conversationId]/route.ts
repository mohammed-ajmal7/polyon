import { ConversationQueryService } from "@polyon/application";

import { isAuthenticated } from "@/server/auth";
import { getPolyonComposition } from "@/server/polyon-server";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ conversationId: string }> },
): Promise<Response> {
  if (!(await isAuthenticated())) {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }

  const { conversationId } = await context.params;
  const id = conversationId.trim();

  if (id === "" || id.length > 200) {
    return Response.json({ error: "Invalid conversation id." }, { status: 400 });
  }

  const snapshot = new ConversationQueryService({
    conversations: getPolyonComposition().stores.conversations,
    messages: getPolyonComposition().stores.messages,
    events: getPolyonComposition().stores.events,
  }).get(id);

  if (snapshot === undefined) {
    return Response.json({ error: "Conversation not found." }, { status: 404 });
  }

  return Response.json(snapshot);
}
