import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { ApprovalRequest } from "@polyon/contracts";
import type { PolyonComposition } from "@polyon/application";

const SUPABASE_URL =
  process.env.POLYON_RUN_STATE_SUPABASE_URL?.trim() ||
  "https://kputedwmsvqdgfmkjkzq.supabase.co";
const SUPABASE_KEY =
  process.env.POLYON_RUN_STATE_SUPABASE_KEY?.trim() ||
  "sb_publishable_kJJa6i4NJlxP42ceGaGLog_7BebV3Ca";

interface ApprovalCheckpoint {
  readonly approval: ApprovalRequest;
  readonly execution?: unknown;
  readonly task?: unknown;
  readonly mission?: unknown;
  readonly proposal?: unknown;
  readonly tasks?: readonly unknown[];
}

export async function persistApprovalCheckpoint(
  composition: PolyonComposition,
  approval: ApprovalRequest,
): Promise<void> {
  const checkpoint: ApprovalCheckpoint = {
    approval,
    ...(approval.executionId === undefined
      ? {}
      : { execution: composition.stores.executions.get(approval.executionId) }),
    ...(approval.taskId === undefined
      ? {}
      : { task: composition.stores.tasks.get(approval.taskId) }),
    ...(approval.missionId === undefined
      ? {}
      : { mission: composition.stores.missions.get(approval.missionId) }),
    ...(approval.proposalId === undefined
      ? {}
      : { proposal: composition.stores.missionPlanProposals.get(approval.proposalId) }),
    ...(approval.proposalId === undefined
      ? {}
      : {
          tasks: (() => {
            const proposal = composition.stores.missionPlanProposals.get(approval.proposalId!);
            return proposal === undefined
              ? []
              : proposal.taskIds.flatMap((taskId) => {
                  const task = composition.stores.tasks.get(taskId);
                  return task === undefined ? [] : [task];
                });
        })(),
        }),
  };

  await callRpc("polyon_approval_checkpoint_upsert", {
    p_approval_id: approval.id,
    p_status: approval.status,
    p_payload: sealPayload(checkpoint),
  });
}

export async function getApprovalCheckpoint(
  approvalId: string,
): Promise<ApprovalCheckpoint | undefined> {
  const rows = await callRpc("polyon_approval_checkpoint_get", {
    p_approval_id: approvalId,
  });
  const row = Array.isArray(rows) ? rows[0] : undefined;
  if (!isRecord(row) || typeof row.payload !== "string") return undefined;
  return openPayload(row.payload) as ApprovalCheckpoint | undefined;
}

export async function listPendingApprovalCheckpoints(
  limit = 100,
): Promise<ApprovalCheckpoint[]> {
  const rows = await callRpc("polyon_approval_checkpoint_list", { p_limit: limit });
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    if (!isRecord(row) || typeof row.payload !== "string") return [];
    const checkpoint = openPayload(row.payload);
    return isRecord(checkpoint) && isRecord(checkpoint.approval)
      ? [checkpoint as unknown as ApprovalCheckpoint]
      : [];
  });
}

async function callRpc(
  functionName:
    | "polyon_approval_checkpoint_upsert"
    | "polyon_approval_checkpoint_get"
    | "polyon_approval_checkpoint_list",
  body: Record<string, unknown>,
): Promise<unknown> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${functionName}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(
      `Durable approval state unavailable (${response.status})${message === "" ? "." : `: ${message.slice(0, 300)}`}`,
    );
  }

  const text = await response.text();
  if (text.trim() === "") return undefined;
  return JSON.parse(text) as unknown;
}

function sealPayload(value: unknown): string {
  const secret = process.env.POLYON_API_TOKEN?.trim();
  if (secret === undefined || secret === "") {
    return `plain.${Buffer.from(JSON.stringify(value), "utf8").toString("base64url")}`;
  }
  const iv = randomBytes(12);
  const key = Buffer.from(createHash("sha256").update(secret).digest("hex"), "hex");
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    Buffer.from(cipher.final("base64"), "base64"),
  ]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

function openPayload(value: string): unknown | undefined {
  try {
    if (value.startsWith("plain.")) {
      return JSON.parse(Buffer.from(value.slice(6), "base64url").toString("utf8")) as unknown;
    }
    const secret = process.env.POLYON_API_TOKEN?.trim();
    if (!secret) return undefined;
    const [version, iv, tag, ciphertext] = value.split(".");
    if (version !== "v1" || !iv || !tag || !ciphertext) return undefined;
    const key = Buffer.from(createHash("sha256").update(secret).digest("hex"), "hex");
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return JSON.parse(
      Buffer.concat([
        decipher.update(Buffer.from(ciphertext, "base64url")),
        Buffer.from(decipher.final("base64"), "base64"),
      ]).toString("utf8"),
    ) as unknown;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
