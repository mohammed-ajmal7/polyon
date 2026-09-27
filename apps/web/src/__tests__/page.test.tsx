import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Home from "../app/page";

describe("POLYON AI HQ shell", () => {
  it("renders the command center", () => {
    render(<Home />);

    expect(screen.getByText("One command. Many intelligences.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "What should POLYON do?" })).toBeInTheDocument();
  });

  it("switches interaction modes", () => {
    render(<Home />);

    fireEvent.click(screen.getByRole("button", { name: "Debate" }));

    expect(
      screen.getByText("Run a bounded proposal, criticism, evidence and adjudication flow."),
    ).toBeInTheDocument();
  });

  it("accepts a command and records it in activity", () => {
    render(<Home />);

    const input = screen.getByPlaceholderText(
      "Describe the outcome you want. POLYON will turn it into governed work.",
    );

    fireEvent.change(input, {
      target: { value: "Review the execution architecture." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run command" }));

    expect(screen.getByText("Command accepted")).toBeInTheDocument();
    expect(screen.getByText("Review the execution architecture.")).toBeInTheDocument();
  });

  it("changes the selected logical agent", () => {
    render(<Home />);

    fireEvent.click(screen.getByRole("button", { name: /Builder Coding & implementation/ }));

    expect(screen.getByText("Builder selected")).toBeInTheDocument();
  });
});
