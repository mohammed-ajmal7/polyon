import "node:process";
import { join } from "node:path";

import { createPolyonComposition, type PolyonComposition } from "@polyon/application";

const globalState = globalThis as typeof globalThis & {
  __polyonComposition?: PolyonComposition;
};

export function getPolyonActorId(): string {
  const actorId = process.env.POLYON_ACTOR_ID?.trim();
  return actorId === undefined || actorId === "" ? "local-user" : actorId;
}

export function getPolyonComposition(): PolyonComposition {
  if (globalState.__polyonComposition !== undefined) {
    return globalState.__polyonComposition;
  }

  const composition = createPolyonComposition({
    storageRoot:
      process.env.POLYON_DATA_DIR?.trim() ||
      join(process.cwd(), ".polyon-data"),
  });

  if (process.env.POLYON_RUNTIME_AUTOSTART !== "false") {
    composition.runtime.start();
  }

  globalState.__polyonComposition = composition;
  return composition;
}

export function sanitizeEventData(
  data: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    const normalized = key.toLowerCase();
    if (
      normalized.includes("secret") ||
      normalized.includes("password") ||
      normalized.includes("token") ||
      normalized.includes("credential") ||
      normalized.includes("authorization")
    ) {
      continue;
    }
    safe[key] = value;
  }
  return safe;
}