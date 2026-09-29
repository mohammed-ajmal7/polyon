import type { ApprovalRequest } from "@polyon/contracts";

/** What the human sees before approving: a plain title and the exact inputs, bounded. */
export interface ApprovalPreview {
  readonly title: string;
  readonly detail?: string;
  readonly input?: string;
  readonly requestedFor?: string;
  readonly agentId?: string;
}

const MAX_INPUT_CHARACTERS = 2_000;
const MAX_REQUEST_CHARACTERS = 300;
const SECRET_KEY = /secret|password|passwd|token|api[-_]?key|authorization|credential/iu;

const TOOL_TITLES: Record<string, string> = {
  "memory.search.scoped": "Search your POLYON memory",
  "memory.remember": "Save something to your POLYON memory",
  "filesystem.read.scoped": "Read a file in the workspace",
  "artifact.list.scoped": "List saved files",
  "artifact.read.scoped": "Read a saved file",
  "artifact.create.text": "Create a file",
  "terminal.execute.scoped": "Run a terminal command",
  "git.read.scoped": "Read the Git repository",
  "git.write.scoped": "Change the Git staging area",
  "git.commit.scoped": "Create a Git commit",
  "git.publish.scoped": "Push commits to a remote",
};

const INTEGRATION_TITLES: Record<string, string> = {
  SEND_EMAIL: "Send an email",
  SEND_MESSAGE: "Send a Telegram message",
  LIST_FILES: "List Google Drive files",
  GET_METADATA: "Read Google Drive file details",
};

const ACTION_TITLES: Record<string, string> = {
  PLAN_APPLY: "Start a mission plan",
  EXECUTION_RUN: "Run a mission step",
};

export function buildApprovalPreview(approval: ApprovalRequest): ApprovalPreview {
  const tool = approval.toolContinuation;
  const integration = approval.integrationContinuation;

  if (integration !== undefined || approval.integrationInvocation !== undefined) {
    const operation = integration?.operation ?? approval.integrationInvocation?.operation ?? "";
    const input = integration?.input ?? approval.integrationInvocation?.input;
    return {
      title: INTEGRATION_TITLES[operation] ?? `Use ${approval.integrationId ?? "an integration"}`,
      detail: `${approval.integrationId ?? "integration"} · ${operation}`,
      ...(input === undefined ? {} : { input: formatInput(input) }),
      ...(integration === undefined
        ? {}
        : requestContext(integration.request, integration.agentId)),
    };
  }

  if (tool !== undefined || approval.toolId !== undefined) {
    const toolId = tool?.toolCall.toolId ?? approval.toolId ?? "";
    return {
      title: TOOL_TITLES[toolId] ?? `Use the tool ${toolId}`,
      detail: toolId,
      ...(tool === undefined ? {} : { input: formatInput(tool.toolCall.input) }),
      ...(tool === undefined ? {} : requestContext(tool.request, tool.agentId)),
    };
  }

  return {
    title:
      ACTION_TITLES[approval.action] ??
      `Allow ${approval.action.toLowerCase().replace(/_/gu, " ")}`,
    ...(approval.missionId === undefined ? {} : { detail: `Mission ${approval.missionId}` }),
  };
}

/** Replaces the policy engine's default reason with a sentence a person can act on. */
export function explainApprovalReason(reason: string): string {
  return reason.startsWith("No policy rule matched")
    ? "Your approval settings ask before POLYON takes this kind of action."
    : reason;
}

function requestContext(
  request: { readonly messages: readonly { readonly role: string; readonly content: string }[] },
  agentId: string,
): Pick<ApprovalPreview, "requestedFor" | "agentId"> {
  const userMessage = [...request.messages].reverse().find((message) => message.role === "USER");
  return {
    agentId,
    ...(userMessage === undefined
      ? {}
      : { requestedFor: truncate(userMessage.content, MAX_REQUEST_CHARACTERS) }),
  };
}

function formatInput(input: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(redact(input), null, 2) ?? String(input);
  } catch {
    text = String(input);
  }
  return truncate(text, MAX_INPUT_CHARACTERS);
}

function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[nested]";
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      SECRET_KEY.test(key) ? "[redacted]" : redact(item, depth + 1),
    ]),
  );
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max) + "…";
}
