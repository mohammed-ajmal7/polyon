import { isAuthenticated } from "@/server/auth";
import { getChatConversation } from "@/server/chat-history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  try {
    const conversation = await getChatConversation(id);
    if (conversation === undefined) {
      return Response.json({ error: "Conversation not found." }, { status: 404 });
    }
    return Response.json(conversation, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Chat history is unavailable." },
      { status: 503 },
    );
  }
}
