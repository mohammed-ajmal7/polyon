"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export default function LoginPage() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || token.trim() === "") return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!response.ok) {
        setError(
          response.status === 401
            ? "That access token is not correct."
            : "POLYON could not sign you in. Try again.",
        );
        return;
      }
      const status = (await fetch("/api/auth", { cache: "no-store" }).then((result) =>
        result.json(),
      )) as { authenticated?: boolean };
      if (status.authenticated !== true) {
        // The server accepted the token but the browser did not keep the session cookie, which
        // happens when a production build is opened over plain HTTP from another machine.
        setError(
          "Signed in, but your browser did not keep the session. Open POLYON over HTTPS or on localhost.",
        );
        return;
      }
      router.replace("/");
      router.refresh();
    } catch {
      setError("POLYON is not reachable. Check that it is running.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[#07090d] px-4 text-slate-100">
      <form
        onSubmit={(event) => void submit(event)}
        className="w-full max-w-sm rounded-3xl border border-white/10 bg-[#0c1017] p-6 shadow-2xl"
      >
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-2xl border border-violet-300/20 bg-violet-300/10 text-sm font-semibold tracking-widest text-violet-200">
            P
          </div>
          <div>
            <h1 className="text-base font-semibold tracking-[0.2em]">POLYON</h1>
            <p className="text-xs text-slate-400">Your private AI team</p>
          </div>
        </div>

        <label htmlFor="token" className="mt-6 block text-sm font-medium text-slate-200">
          Access token
        </label>
        <p id="token-help" className="mt-1 text-xs leading-5 text-slate-400">
          The value of POLYON_API_TOKEN from your server configuration.
        </p>
        <input
          id="token"
          type="password"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          aria-describedby="token-help"
          aria-invalid={error !== null}
          autoComplete="current-password"
          autoFocus
          className="mt-3 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-3 text-sm text-slate-100 outline-none focus-visible:ring-2 focus-visible:ring-violet-300/60"
        />

        {error !== null ? (
          <p
            role="alert"
            className="mt-3 rounded-xl bg-rose-400/10 px-3 py-2 text-sm text-rose-200"
          >
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={pending || token.trim() === ""}
          className="mt-4 w-full rounded-xl bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-900 transition hover:bg-white focus-visible:ring-2 focus-visible:ring-violet-300/60 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
