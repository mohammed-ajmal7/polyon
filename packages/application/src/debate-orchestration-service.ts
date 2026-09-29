import type {
  AgentId,
  Debate,
  DomainEvent,
  ModelMessage,
  TextModelRequest,
} from "@polyon/contracts";
import { advanceDebatePhase, createDebate, decideDebate, startDebate } from "@polyon/core";
import type {
  DebateStore,
  DomainStoreTransactionContext,
  DomainUnitOfWork,
  EventStore,
} from "@polyon/storage";

import { buildAgentRolePrompt, type AgentGateway, type AgentRegistry } from "@polyon/agents";

const MAX_PROMPT_CONTEXT = 48_000;
const MAX_CONTRIBUTION_LENGTH = 100_000;

export interface CreateDebateInput {
  readonly id: string;
  readonly objective: string;
  readonly participantAgentIds: readonly AgentId[];
  readonly maxParticipants: number;
  readonly maxRounds: number;
  readonly createdAt: string;
}

export interface RunDebateInput {
  readonly debateId: string;
  readonly runId?: string;
  readonly requiredCapabilityIds: readonly string[];
  readonly adjudicatorAgentId: AgentId;
  readonly now: () => string;
  readonly modelOptions?: import("@polyon/providers").ModelInvocationOptions;
  readonly signal?: AbortSignal;
  readonly context?: string;
}

export interface DebateRunResult {
  readonly debate: Debate;
  readonly decision: string;
  readonly contributions: readonly {
    readonly agentId: AgentId;
    readonly round: number;
    readonly phase: Debate["phase"];
    readonly content: string;
  }[];
}

export class DebateOrchestrationService {
  constructor(
    private readonly agentGateway: AgentGateway,
    private readonly debates: DebateStore,
    private readonly events: EventStore,
    private readonly unitOfWork?: DomainUnitOfWork,
    private readonly agents?: AgentRegistry,
  ) {}

  create(input: CreateDebateInput): Debate {
    const debate = createDebate(input);
    const operation = (stores: Pick<DomainStoreTransactionContext, "debates" | "events">) => {
      if (stores.debates.get(debate.id) !== undefined) {
        throw new Error(`Debate already exists: ${debate.id}.`);
      }
      stores.debates.save(debate);
      stores.events.append(
        this.debateEvent("DEBATE_STATUS_CHANGED", debate, debate.createdAt, {
          from: "NONE",
          to: "DRAFT",
        }),
      );
      return debate;
    };
    return this.unitOfWork === undefined
      ? operation({ debates: this.debates, events: this.events })
      : this.unitOfWork.transaction(operation);
  }

  async run(input: RunDebateInput): Promise<DebateRunResult> {
    const loadedDebate = this.debates.get(input.debateId);
    if (loadedDebate === undefined) throw new Error(`Debate not found: ${input.debateId}.`);
    let debate = loadedDebate;
    if (!debate.participantAgentIds.includes(input.adjudicatorAgentId)) {
      throw new Error("Adjudicator must be one of the debate participants.");
    }

    const persistedContributions = this.loadContributions(debate.id);
    const contributions: DebateRunResult["contributions"][number][] = [...persistedContributions];

    if (debate.status === "DECIDED") {
      const decisionEvent = this.events
        .list()
        .find(
          (event) =>
            event.kind === "DEBATE_DECIDED" &&
            event.data.debateId === debate.id &&
            typeof event.data.decision === "string",
        );
      if (decisionEvent === undefined) throw new Error("Decided debate has no decision trace.");
      return { debate, decision: String(decisionEvent.data.decision), contributions };
    }

    if (debate.status === "DRAFT") {
      debate = startDebate(debate, input.now());
      this.persistStatus(debate, input.now(), "DRAFT");
    }

    while (debate.status === "RUNNING") {
      for (const agentId of debate.participantAgentIds) {
        const existing = contributions.find(
          (candidate) =>
            candidate.agentId === agentId &&
            candidate.round === debate.currentRound &&
            candidate.phase === debate.phase,
        );
        if (existing !== undefined) continue;

        const contribution = await this.invokeContribution(debate, agentId, contributions, input);
        contributions.push(contribution);
        this.persistContribution(debate, contribution);
      }

      const next = advanceDebatePhase(debate, input.now());
      this.persistStatus(next, input.now(), debate.status);
      debate = next;
    }

    if (debate.status !== "ADJUDICATING") {
      throw new Error(`Debate ${debate.id} did not reach adjudication.`);
    }

    const decision = await this.invokeAdjudication(
      debate,
      input.adjudicatorAgentId,
      contributions,
      input,
    );
    const decided = decideDebate(debate, input.now());
    this.persistDecision(decided, input.now(), decision);
    return { debate: decided, decision, contributions };
  }

  private loadContributions(debateId: string): DebateRunResult["contributions"] {
    return this.events
      .list()
      .filter((event) => event.kind === "DEBATE_CONTRIBUTION" && event.data.debateId === debateId)
      .map((event) => ({
        agentId: String(event.data.agentId),
        round: Number(event.data.round),
        phase: event.data.phase as Debate["phase"],
        content: String(event.data.content),
      }))
      .sort(
        (a, b) =>
          a.round - b.round || a.phase.localeCompare(b.phase) || a.agentId.localeCompare(b.agentId),
      );
  }

  private async invokeContribution(
    debate: Debate,
    agentId: AgentId,
    existing: readonly DebateRunResult["contributions"][number][],
    input: RunDebateInput,
  ): Promise<DebateRunResult["contributions"][number]> {
    const role = phaseInstruction(debate.phase);
    const context = formatContributions(existing);
    const request: TextModelRequest = {
      messages: [
        {
          role: "SYSTEM",
          content:
            "You are a bounded debate participant in POLYON. Follow the phase role, " +
            "stay evidence-focused, and do not take external actions.\n" +
            buildAgentRolePrompt(
              this.agents?.get(agentId),
              "analysis",
            ),
        },
        {
          role: "USER",
          content:
            `Objective: ${debate.objective}\nRound: ${debate.currentRound}\n` +
            `Phase: ${debate.phase}\nRole: ${role}\n\nPrior contributions:\n${context}` +
            (input.context === undefined ? "" : `\n\nShared analysis context:\n${input.context}`),
        },
      ],
    };

    const response = await this.agentGateway.invokeText({
      agentId,
      runId: input.runId,
      requiredCapabilityIds: input.requiredCapabilityIds,
      request,
      modelOptions: input.modelOptions,
    });

    return {
      agentId,
      round: debate.currentRound,
      phase: debate.phase,
      content: response.output.content.slice(0, MAX_CONTRIBUTION_LENGTH),
    };
  }

  private async invokeAdjudication(
    debate: Debate,
    adjudicatorAgentId: AgentId,
    contributions: readonly DebateRunResult["contributions"][number][],
    input: RunDebateInput,
  ): Promise<string> {
    const context = formatContributions(contributions);
    const request: TextModelRequest = {
      messages: [
        {
          role: "SYSTEM",
          content:
            "You are the adjudicator for a finite POLYON debate. " +
            "Evaluate arguments and evidence, " +
            "identify uncertainty and conflicts, and produce a concise decision rationale. " +
            "Do not claim external verification you did not receive.\n" +
            buildAgentRolePrompt(
              this.agents?.get(adjudicatorAgentId),
              "judge",
            ),
        },
        {
          role: "USER",
          content:
            `Objective: ${debate.objective}\nDebate transcript:\n${context}` +
            (input.context === undefined ? "" : `\n\nShared analysis context:\n${input.context}`) +
            "\n\nReturn a reasoned adjudication.",
        },
      ],
    };

    const response = await this.agentGateway.invokeText({
      agentId: adjudicatorAgentId,
      runId: input.runId,
      requiredCapabilityIds: input.requiredCapabilityIds,
      request,
      modelOptions: input.modelOptions,
    });
    return response.output.content.slice(0, MAX_CONTRIBUTION_LENGTH);
  }

  private persistStatus(debate: Debate, now: string, from: Debate["status"]): void {
    const operation = (stores: Pick<DomainStoreTransactionContext, "debates" | "events">) => {
      stores.debates.save(debate);
      stores.events.append(
        this.debateEvent("DEBATE_STATUS_CHANGED", debate, now, {
          from,
          to: debate.status,
          phase: debate.phase,
          round: debate.currentRound,
        }),
      );
    };
    if (this.unitOfWork === undefined) {
      operation({ debates: this.debates, events: this.events });
    } else {
      this.unitOfWork.transaction(operation);
    }
  }

  private persistContribution(
    debate: Debate,
    contribution: DebateRunResult["contributions"][number],
  ): void {
    const event: DomainEvent = {
      id:
        `DEBATE_CONTRIBUTION:${debate.id}:r${contribution.round}:${contribution.phase}:` +
        contribution.agentId,
      kind: "DEBATE_CONTRIBUTION",
      data: {
        debateId: debate.id,
        agentId: contribution.agentId,
        round: contribution.round,
        phase: contribution.phase,
        content: contribution.content,
      },
      occurredAt: debate.updatedAt,
    };
    this.events.append(event);
  }

  private persistDecision(debate: Debate, now: string, decision: string): void {
    const operation = (stores: Pick<DomainStoreTransactionContext, "debates" | "events">) => {
      stores.debates.save(debate);
      stores.events.append(
        this.debateEvent("DEBATE_DECIDED", debate, now, {
          decision,
        }),
      );
    };
    if (this.unitOfWork === undefined) {
      operation({ debates: this.debates, events: this.events });
    } else {
      this.unitOfWork.transaction(operation);
    }
  }

  private debateEvent(
    kind: DomainEvent["kind"],
    debate: Debate,
    occurredAt: string,
    data: Record<string, unknown>,
  ): DomainEvent {
    const from = typeof data.from === "string" ? data.from : "";
    const to = typeof data.to === "string" ? data.to : "";
    const phase = typeof data.phase === "string" ? data.phase : debate.phase;
    const round = typeof data.round === "number" ? String(data.round) : String(debate.currentRound);

    return {
      id: `${kind}:${debate.id}:${occurredAt}:${from}:${to}:${phase}:${round}`,
      kind,
      occurredAt,
      data: { debateId: debate.id, ...data },
    };
  }
}

function promptStageForDebatePhase(
  phase: Debate["phase"],
): "analysis" | "critique" | "fact-check" | "judge" {
  switch (phase) {
    case "PROPOSAL":
    case "REBUTTAL":
      return "analysis";
    case "CRITICISM":
      return "critique";
    case "EVIDENCE":
      return "fact-check";
    case "ADJUDICATION":
      return "judge";
  }
}

function phaseInstruction(phase: Debate["phase"]): string {
  switch (phase) {
    case "PROPOSAL":
      return "Construct the strongest candidate answer and clearly state assumptions.";
    case "CRITICISM":
      return "Challenge the strongest weaknesses, edge cases, and unsupported claims.";
    case "EVIDENCE":
      return "Identify what evidence is needed, cite available evidence, and distinguish gaps.";
    case "REBUTTAL":
      return "Respond to the strongest criticism without hiding uncertainty.";
    case "ADJUDICATION":
      return "Synthesize the transcript into a reasoned decision.";
  }
}

function formatContributions(
  contributions: readonly DebateRunResult["contributions"][number][],
): string {
  const lines: string[] = [];
  let total = 0;
  for (const item of contributions) {
    const line = `[${item.round}/${item.phase}/${item.agentId}] ${item.content}`;
    if (total + line.length > MAX_PROMPT_CONTEXT) break;
    lines.push(line);
    total += line.length + 1;
  }
  return lines.join("\n");
}
