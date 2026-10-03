import { isAuthenticated } from "@/server/auth";
import { listChatConversations } from "@/server/chat-history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  if (!(await isAuthenticated())) {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }

  const raw = Number(new URL(request.url).searchParams.get("limit") ?? 50);
  const limit = Math.min(100, Math.max(1, Number.isFinite(raw) ? Math.floor(raw) : 50));

  try {
    const conversations = await listChatConversations(limit);
    return Response.json(
      {
        conversations: conversations.map((conversation) => ({
          conversationId: conversation.conversationId,
          title: conversation.title,
          messageCount: conversation.messages.length,
          createdAt: conversation.createdAt,
          updatedAt: conversation.updatedAt,
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Chat history is unavailable." },
      { status: 503 },
    );
  }
}
