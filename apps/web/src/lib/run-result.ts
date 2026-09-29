/**
 * Turns the mode-specific `/api/execute` result into one answer view, so the home screen can
 * show "the answer" without the user knowing which orchestration mode produced it.
 */

export type RunOutcome = "answered" | "partial" | "needs-approval" | "planned" | "failed";

export interface RunContributor {
  readonly agentId: string;
  readonly role?: string;
}

export interface RunCheck {
  readonly claim: string;
  readonly verdict: string;
  readonly rationale: string;
}

export interface RunView {
  readonly outcome: RunOutcome;
  readonly headline: string;
  readonly answer?: string;
  readonly contributors: readonly RunContributor[];
  readonly confirmed: readonly RunCheck[];
  readonly uncertain: readonly RunCheck[];
  readonly problems: readonly string[];
  readonly sourceCount: number;
  readonly approvalsWaiting: number;
  readonly missionId?: string;
  readonly conversationId?: string;
}

type Json = Record<string, unknown>;

export function toRunView(mode: string, payload: unknown): RunView {
  const result = record(record(payload).result);
  switch (mode) {
    case "Direct":
    case "Broadcast":
      return fromConversation(result);
    case "Collaborative":
      return fromCollective(result);
    case "Research":
      return fromResearch(result);
    case "DeepAnalysis":
      return fromDeepAnalysis(result);
    case "Debate":
      return fromDebate(result);
    case "Mission":
      return fromMission(result);
    default:
      return empty("failed", "POLYON returned a result it could not display.");
  }
}

function fromConversation(result: Json): RunView {
  const responses = array(result.responses).map(record);
  const answers: string[] = [];
  const problems: string[] = [];
  let approvalsWaiting = 0;

  for (const response of responses) {
    const agentResult = record(response.result);
    const status = string(agentResult.status);
    const content = string(record(agentResult.response).content);
    if (status === "SUCCEEDED" && content !== undefined && content.trim() !== "") {
      answers.push(responses.length > 1 ? `${string(response.agentId)}:\n${content}` : content);
    } else if (status === "APPROVAL_REQUIRED") {
      approvalsWaiting += 1;
    } else {
      problems.push(string(agentResult.error) ?? `${string(response.agentId)} could not answer.`);
    }
  }

  const status = string(result.status);
  const outcome: RunOutcome =
    status === "APPROVAL_REQUIRED"
      ? "needs-approval"
      : answers.length > 0
        ? problems.length > 0
          ? "partial"
          : "answered"
        : "failed";

  return {
    ...empty(outcome, headlineFor(outcome)),
    ...(answers.length === 0 ? {} : { answer: answers.join("\n\n") }),
    contributors: responses.map((response) => ({ agentId: string(response.agentId) ?? "agent" })),
    problems,
    approvalsWaiting,
  };
}

function fromCollective(result: Json): RunView {
  const synthesis = string(record(result.synthesis).content);
  const checks = array(result.factChecks).map(record).map(toCheck);
  const outcome = outcomeFromStatus(string(result.status), synthesis);
  return {
    ...empty(outcome, headlineFor(outcome)),
    ...(synthesis === undefined ? {} : { answer: synthesis }),
    contributors: array(result.contributions)
      .map(record)
      .map((item) => ({
        agentId: string(item.agentId) ?? "agent",
        ...(string(item.role) === undefined ? {} : { role: string(item.role) }),
      })),
    confirmed: checks.filter((check) => check.verdict === "SUPPORTED"),
    uncertain: checks.filter((check) => check.verdict !== "SUPPORTED"),
    problems: failures(result),
    sourceCount: array(result.sourceIds).length,
    ...(string(result.conversationId) === undefined
      ? {}
      : { conversationId: string(result.conversationId) }),
  };
}

function fromResearch(result: Json): RunView {
  const synthesis = string(record(result.synthesis).content);
  const outcome = outcomeFromStatus(string(result.status), synthesis);
  return {
    ...empty(outcome, headlineFor(outcome)),
    ...(synthesis === undefined ? {} : { answer: synthesis }),
    contributors: array(result.findings)
      .map(record)
      .map((item) => ({ agentId: string(item.agentId) ?? "agent" })),
    problems: failures(result),
    sourceCount: array(result.sourceIds).length,
    ...(string(result.conversationId) === undefined
      ? {}
      : { conversationId: string(result.conversationId) }),
  };
}

function fromDeepAnalysis(result: Json): RunView {
  const collective = fromCollective(record(result.collective));
  const decision = string(record(result.decision).content);
  const answer = decision ?? collective.answer;
  const outcome = outcomeFromStatus(string(result.status), answer);
  return {
    ...collective,
    outcome,
    headline: headlineFor(outcome),
    ...(answer === undefined ? {} : { answer }),
  };
}

function fromDebate(result: Json): RunView {
  const decision = string(result.decision);
  const outcome: RunOutcome = decision === undefined ? "failed" : "answered";
  return {
    ...empty(outcome, headlineFor(outcome)),
    ...(decision === undefined ? {} : { answer: decision }),
    contributors: unique(
      array(result.contributions)
        .map(record)
        .map((item) => string(item.agentId) ?? "agent"),
    ).map((agentId) => ({ agentId })),
  };
}

function fromMission(result: Json): RunView {
  const status = string(result.status);
  const mission = record(result.mission);
  const missionId = string(mission.id);
  const outcome: RunOutcome =
    status === "PLAN_DENIED"
      ? "failed"
      : status === "PLAN_APPROVAL_REQUIRED"
        ? "needs-approval"
        : "planned";
  return {
    ...empty(outcome, headlineFor(outcome)),
    answer:
      status === "PLAN_APPROVAL_REQUIRED"
        ? "POLYON drafted a plan. Review and approve it to start the work."
        : status === "PLAN_DENIED"
          ? "The plan was not allowed by your policy."
          : "The plan was accepted and its first steps are running.",
    approvalsWaiting: status === "PLAN_APPROVAL_REQUIRED" ? 1 : 0,
    ...(missionId === undefined ? {} : { missionId }),
  };
}

function outcomeFromStatus(status: string | undefined, answer: string | undefined): RunOutcome {
  if (answer === undefined || answer.trim() === "") return "failed";
  return status === "SUCCEEDED" ? "answered" : "partial";
}

function headlineFor(outcome: RunOutcome): string {
  switch (outcome) {
    case "answered":
      return "Here is what POLYON found.";
    case "partial":
      return "POLYON answered, but some of the team could not finish.";
    case "needs-approval":
      return "POLYON is waiting for your approval.";
    case "planned":
      return "POLYON started the work.";
    case "failed":
      return "POLYON could not complete this request.";
  }
}

function failures(result: Json): string[] {
  return array(result.failures)
    .map(record)
    .map((item) => `${string(item.agentId) ?? "An agent"}: ${string(item.error) ?? "failed"}`);
}

function toCheck(item: Json): RunCheck {
  return {
    claim: string(item.claim) ?? "",
    verdict: string(item.verdict) ?? "UNRESOLVED",
    rationale: string(item.rationale) ?? "",
  };
}

function empty(outcome: RunOutcome, headline: string): RunView {
  return {
    outcome,
    headline,
    contributors: [],
    confirmed: [],
    uncertain: [],
    problems: [],
    sourceCount: 0,
    approvalsWaiting: 0,
  };
}

function record(value: unknown): Json {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Json)
    : {};
}

function array(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function string(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/** Plain-language labels for agent ids such as "primary-fact-checker". */
export function agentLabel(agentId: string): string {
  const role = agentId.replace(/^primary-/u, "").replace(/-/gu, " ");
  return role.charAt(0).toUpperCase() + role.slice(1);
}
