export interface ChatMessage {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly createdAt: string;
}

export interface ChatRecord {
  readonly id: string;
  readonly title: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly messages: readonly ChatMessage[];
}

export const CHAT_STORAGE_KEY = "polyon.chats.v1";
export const ACTIVE_CHAT_STORAGE_KEY = "polyon.activeChat.v1";
export const CHAT_CHANGE_EVENT = "polyon:chats-changed";

const MAX_CHATS = 200;
const MAX_MESSAGES_PER_CHAT = 500;
const MAX_MESSAGE_CHARS = 100_000;

export function readChats(): ChatRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(CHAT_STORAGE_KEY);
    if (raw === null) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isChatRecord).slice(0, MAX_CHATS);
  } catch {
    return [];
  }
}

export function writeChats(chats: readonly ChatRecord[]): void {
  if (typeof window === "undefined") return;
  try {
    const normalized = [...chats]
      .filter(isChatRecord)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, MAX_CHATS);
    window.localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(normalized));
    window.dispatchEvent(new Event(CHAT_CHANGE_EVENT));
  } catch {
    // Browser storage is a durable convenience layer; the server conversation remains authoritative.
  }
}

export function upsertChat(chat: ChatRecord): void {
  const chats = readChats().filter((item) => item.id !== chat.id);
  writeChats([
    {
      ...chat,
      title: normalizeTitle(chat.title),
      messages: chat.messages.slice(-MAX_MESSAGES_PER_CHAT).map(normalizeMessage),
    },
    ...chats,
  ]);
}

export function getChat(id: string | null | undefined): ChatRecord | undefined {
  if (id === undefined || id === null || id.trim() === "") return undefined;
  return readChats().find((chat) => chat.id === id);
}

export function getActiveChatId(): string | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const id = window.localStorage.getItem(ACTIVE_CHAT_STORAGE_KEY);
    return id === null || id.trim() === "" ? undefined : id;
  } catch {
    return undefined;
  }
}

export function setActiveChatId(id: string | undefined): void {
  if (typeof window === "undefined") return;
  try {
    if (id === undefined) window.localStorage.removeItem(ACTIVE_CHAT_STORAGE_KEY);
    else window.localStorage.setItem(ACTIVE_CHAT_STORAGE_KEY, id);
    window.dispatchEvent(new Event(CHAT_CHANGE_EVENT));
  } catch {
    // Ignore storage failures.
  }
}

export function titleFromCommand(command: string): string {
  const clean = command.replace(/\s+/gu, " ").trim();
  if (clean === "") return "New chat";
  const words = Array.from(clean);
  return words.length > 52 ? words.slice(0, 52).join("").trimEnd() + "…" : clean;
}

export function normalizeAssistantText(content: string): string {
  return content
    .replace(/\\\*\\\*/gu, "**")
    .replace(/\\_/gu, "_")
    .replace(/\\#/gu, "#")
    .replace(/\\-/gu, "-")
    .replace(/\\>/gu, ">")
    .replace(/\\\[/gu, "[")
    .replace(/\\\]/gu, "]")
    .trim();
}

function normalizeTitle(value: string): string {
  const clean = value.replace(/\s+/gu, " ").trim();
  return clean === "" ? "New chat" : clean.slice(0, 80);
}

function normalizeMessage(message: ChatMessage): ChatMessage {
  return {
    id: message.id,
    role: message.role,
    content: message.content.slice(0, MAX_MESSAGE_CHARS),
    createdAt: message.createdAt,
  };
}

function isChatRecord(value: unknown): value is ChatRecord {
  if (value === null || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === "string" &&
    item.id.length > 0 &&
    typeof item.title === "string" &&
    typeof item.createdAt === "string" &&
    typeof item.updatedAt === "string" &&
    Array.isArray(item.messages) &&
    item.messages.every(isChatMessage)
  );
}

function isChatMessage(value: unknown): value is ChatMessage {
  if (value === null || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === "string" &&
    (item.role === "user" || item.role === "assistant") &&
    typeof item.content === "string" &&
    typeof item.createdAt === "string"
  );
}
