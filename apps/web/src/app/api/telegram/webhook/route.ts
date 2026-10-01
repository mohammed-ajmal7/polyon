import { readBoundedText } from "@/server/bounded-body";
import { executionEnabled, getPolyonComposition, getPolyonPolicy } from "@/server/polyon-server";
import {
  buildTelegramReplyPolicy,
  parseTelegramAllowedChatIds,
  parseTelegramInboundCommand,
} from "@/server/telegram-webhook";

export const runtime = "nodejs";

const MAX_REQUEST_BYTES = 65_536;
const MAX_TELEGRAM_RESPONSE_CHARS = 4_096;

export async function POST(request: Request): Promise<Response> {
  const configuredSecret = process.env.POLYON_TELEGRAM_WEBHOOK_SECRET?.trim();
  const receivedSecret = request.headers.get("x-telegram-bot-api-secret-token")?.trim();
  if (
    configuredSecret === undefined ||
    configuredSecret === "" ||
    receivedSecret === undefined ||
    receivedSecret !== configuredSecret
  ) return Response.json({ error: "Webhook authentication failed." }, { status: 401 });

  if (!executionEnabled()) return Response.json({ error: "Execution is disabled." }, { status: 503 });

  const allowedChatIds = parseTelegramAllowedChatIds(process.env.POLYON_TELEGRAM_ALLOWED_CHAT_IDS);
  if (allowedChatIds.length === 0) {
    return Response.json({ error: "No Telegram chat IDs are allowlisted." }, { status: 503 });
  }

  const raw = await readBoundedText(request, MAX_REQUEST_BYTES);
  if (raw === undefined) {
    return Response.json({ error: "Telegram update exceeds the request size limit." }, { status: 413 });
  }

  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Telegram update must be valid JSON." }, { status: 400 });
  }

  const command = parseTelegramInboundCommand(input);
  if (command === undefined || !allowedChatIds.includes(command.chatId)) {
    return Response.json({ ok: true }, { status: 200 });
  }

  const polyon = getPolyonComposition();
  const agents = polyon.agents.list().filter((agent) => agent.status === "ACTIVE");
  const target = agents.find((agent) => agent.roleId === "action-agent") ?? agents[0];
  if (target === undefined) {
    return Response.json({ error: "No active POLYON agent is configured." }, { status: 503 });
  }

  const actorId = "telegram-user:" + command.userId;
  const commandResult = polyon.commandIngress.submit({
    mode: "Direct",
    command: command.text,
    actorId,
    conversationId: "telegram:chat:" + command.chatId,
    messageId: `telegram:message:${command.updateId}`,
    eventId: `telegram:event:${command.updateId}`,
    participantIds: [actorId, target.id],
    createdAt: new Date().toISOString(),
  });

  const execution = await polyon.conversationOrchestration.execute({
    command: commandResult,
    targets: [{ agentId: target.id, actorId: target.id }],
    requiredCapabilityIds: [],
    policy: getPolyonPolicy(),
    actorId,
    maxToolRounds: 8,
    maxToolOutputBytes: 64 * 1024,
  });

  const successfulResponse = execution.responses.find(
    (item): item is (typeof execution.responses)[number] & {
      result: Extract<(typeof item.result), { status: "SUCCEEDED" }>;
    } => item.result.status === "SUCCEEDED",
  );
  const responseText =
    successfulResponse?.result.response.content ??
    (execution.status === "APPROVAL_REQUIRED"
      ? "POLYON needs approval before it can complete that action. Please review it in the POLYON workspace."
      : "POLYON could not complete that request.");

  const boundedResponse = Array.from(responseText).slice(0, MAX_TELEGRAM_RESPONSE_CHARS).join("");
  const now = new Date().toISOString();
  const reply = await polyon.integrationInvocation.invoke({
    invocationId: `telegram:reply:${command.updateId}`,
    integrationId: "telegram-primary",
    operation: "SEND_MESSAGE",
    input: { chatId: command.chatId, text: boundedResponse },
    action: "EXTERNAL_COMMUNICATION",
    riskLevel: "LOW",
    policy: buildTelegramReplyPolicy(now),
    decisionId: `telegram:reply-policy:${command.updateId}`,
    approvalRequestId: `telegram:reply-approval:${command.updateId}`,
    requestedBy: actorId,
    requestedAt: now,
    evaluatedAt: now,
    actorId,
  });

  if (reply.status !== "SUCCEEDED") {
    return Response.json({ error: "Telegram reply was not delivered." }, { status: 502 });
  }

  return Response.json({ ok: true }, { status: 200 });
}
