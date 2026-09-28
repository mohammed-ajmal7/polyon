import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

import Home from "../app/page";

const overview = {
  actorId: "local-user",
  agents: [
    {
      id: "agent-1",
      name: "Primary",
      role: "General operations",
      status: "ACTIVE",
      preferredModelId: "model-1",
    },
  ],
  approvals: [],
  counts: {
    executions: 0,
    queued: 0,
    active: 0,
    memories: 0,
    sources: 0,
    evidence: 0,
    debates: 0,
    artifacts: 0,
    events: 0,
  },
  activity: [],
};

describe("POLYON AI HQ", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/api/overview")) {
          return new Response(JSON.stringify(overview), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }

        if (url.endsWith("/api/execute") && init?.method === "POST") {
          return new Response(JSON.stringify({ result: { status: "QUEUED" } }), {
            status: 201,
            headers: { "content-type": "application/json" },
          });
        }

        return new Response("{}", { status: 200 });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the live command center", async () => {
    const { unmount } = render(<Home />);

    expect(
      screen.getByText("One command. Many intelligences."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "What should POLYON do?" }),
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getAllByText("Primary").length).toBeGreaterThan(0);
    });
    unmount();
  });

  it("switches interaction modes", () => {
    const { unmount } = render(<Home />);

    fireEvent.click(screen.getByRole("button", { name: "Debate" }));

    expect(
      screen.getByText(
        "Run a bounded proposal, criticism, evidence and adjudication flow.",
      ),
    ).toBeInTheDocument();
    unmount();
  });

  it("submits commands through the governed execution endpoint", async () => {
    const { unmount } = render(<Home />);
    const input = screen.getByPlaceholderText("Give POLYON a command...");

    fireEvent.change(input, {
      target: { value: "Review the execution architecture." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit command" }));

    await waitFor(() => {
      expect(screen.getByText("Last governed submission: QUEUED")).toBeInTheDocument();
    });

    expect(fetch).toHaveBeenCalledWith(
      "/api/execute",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          mode: "Mission",
          command: "Review the execution architecture.",
        }),
      }),
    );
    unmount();
  });

  it("shows the authentication gate when the server requires login", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/api/overview")) {
        return new Response(JSON.stringify({ error: "Authentication required." }), {
          status: 401,
        });
      }
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { unmount } = render(<Home />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Authentication required" })).toBeInTheDocument();
    });
    unmount();
  });
});
