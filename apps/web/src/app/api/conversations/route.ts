import { isAuthenticated } from "@/server/auth";
import {
  listDurableConversationHistory,
  listLocalConversationHistory,
} from "@/server/chat-history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  if (!(await isAuthenticated())) return Response.json({ error: "Authentication required." }, { status: 401 });

  try {
    const conversations =
      process.env.VERCEL === "1"
        ? await listDurableConversationHistory(100)
        : listLocalConversationHistory(100);

    return Response.json(
      {
        conversations: conversations.map((conversation) => ({
          id: conversation.id,
          kind: conversation.kind,
          status: conversation.status,
          createdAt: conversation.createdAt,
          updatedAt: conversation.updatedAt,
          missionId: conversation.missionId,
          messageCount: conversation.messages.length,
          preview: conversation.messages.find((message) => message.role === "USER")?.content ?? "",
        })),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return Response.json({ error: "Chat history is temporarily unavailable." }, { status: 503 });
  }
}
