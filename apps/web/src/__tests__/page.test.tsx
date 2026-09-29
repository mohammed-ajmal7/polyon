import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import HomePage from "../app/(workspace)/page";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("POLYON home", () => {
  let approvals: unknown[] = [];

  beforeEach(() => {
    approvals = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        if (url.endsWith("/api/approvals")) return json({ approvals });
        if (url.endsWith("/api/execute") && init?.method === "POST") {
          const body = JSON.parse(typeof init.body === "string" ? init.body : "{}") as {
            conversationId?: string;
          };
          return json({ runId: body.conversationId, status: "running", mode: "Direct" }, 202);
        }
        if (url.includes("/api/runs/")) {
          return json({
            status: "succeeded",
            mode: "Direct",
            modeReason: "The request can be answered directly.",
            result: {
              status: "SUCCEEDED",
              responses: [
                {
                  agentId: "primary-action-agent",
                  result: { status: "SUCCEEDED", response: { content: "Hello from POLYON." } },
                },
              ],
            },
          });
        }
        return json({});
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("offers one simple input with automatic depth selected", () => {
    const { unmount } = render(<HomePage />);

    expect(screen.getByRole("heading", { name: "What should POLYON handle?" })).toBeInTheDocument();
    expect(screen.getByLabelText("Request for POLYON")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Auto" })).toHaveAttribute("aria-checked", "true");
    unmount();
  });

  it("sends the request with Auto mode and shows the answer", async () => {
    const { unmount } = render(<HomePage />);

    fireEvent.change(screen.getByLabelText("Request for POLYON"), {
      target: { value: "Hi team, how are you?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(
      () => {
        expect(screen.getByText("Hello from POLYON.")).toBeInTheDocument();
      },
      { timeout: 6_000 },
    );
    expect(screen.getByText("Here is what POLYON found.")).toBeInTheDocument();

    const executeCall = vi
      .mocked(fetch)
      .mock.calls.find(([url]) => typeof url === "string" && url.endsWith("/api/execute"));
    const requestBody = executeCall?.[1]?.body;
    const body = JSON.parse(typeof requestBody === "string" ? requestBody : "{}") as Record<
      string,
      unknown
    >;
    expect(body).toMatchObject({ mode: "Auto", command: "Hi team, how are you?", async: true });
    expect(body.conversationId).toEqual(expect.any(String));
    unmount();
  });

  it("points to waiting approvals", async () => {
    approvals = [{ id: "approval-1" }];
    const { unmount } = render(<HomePage />);

    await waitFor(() => {
      expect(screen.getByText("1 action is waiting for your approval.")).toBeInTheDocument();
    });
    unmount();
  });
});
