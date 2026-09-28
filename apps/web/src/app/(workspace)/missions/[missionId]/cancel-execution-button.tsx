"use client";

import { useState } from "react";

export function CancelExecutionButton({ executionId }: { executionId: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function cancel() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/executions/" + encodeURIComponent(executionId), {
        method: "POST",
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Cancellation failed.");
      setMessage("Cancellation requested.");
      window.location.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Cancellation failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 flex items-center gap-3">
      <button
        type="button"
        onClick={() => void cancel()}
        disabled={busy}
        className="rounded-lg border border-rose-300/15 bg-rose-300/5 px-3 py-2 text-[11px] font-medium text-rose-200 disabled:opacity-40"
      >
        {busy ? "Canceling…" : "Cancel execution"}
      </button>
      {message ? <span className="text-[11px] text-slate-500">{message}</span> : null}
    </div>
  );
}
