import type {
  AgentId,
  DomainEvent,
  Evidence,
  Message,
  Source,
  TextModelRequest,
} from "@polyon/contracts";
import {
  buildAgentRolePrompt,
  type AgentGateway,
  type AgentRegistry,
  type AgentTeamPlanningRequest,
  type AgentTeamPlan,
} from "@polyon/agents";
import type {
  ConversationStore,
  DomainUnitOfWork,
  EventStore,
  MessageStore,
} from "@polyon/storage";
import type { CommandIngressResult } from "./command-ingress";
import type { ResearchService } from "./research-service";
import type { AgentRunService } from "./agent-run-service";
import type { FactCheckResult, FactCheckService } from "./fact-check-service";

const DEFAULT_MAX_PARTICIPANTS = 8;
const MIN_PARTICIPANTS = 2;
const DEFAULT_RESEARCH_SOURCE_LIMIT = 3;
const DEFAULT_MAX_CHALLENGE_ROUNDS = 1;
const MAX_CHALLENGE_ROUNDS = 2;
const MAX_CONTRIBUTION_CHARACTERS = 12_000;
const MAX_CHALLENGE_CONTEXT_CHARACTERS = 50_000;
const MAX_SYNTHESIS_CONTEXT_CHARACTERS = 60_000;
const MAX_EVIDENCE_CONTEXT_CHARACTERS = 60_000;

export interface CollectiveTarget {
  readonly agentId: AgentId;
  readonly actorId: string;
}

export interface ExecuteCollectiveInput {
  readonly command: CommandIngressResult;
  readonly targets?: readonly CollectiveTarget[];
  readonly actorId: string;
  readonly requiredCapabilityIds: readonly string[];
  readonly synthesizerAgentId?: AgentId;
  readonly maxParticipants?: number;
  readonly maxChallengeRounds?: number;
  readonly researchEnabled?: boolean;
  readonly researchSourceLimit?: number;
  readonly factCheckerAgentId?: AgentId;
  readonly now?: () => string;
}

export interface CollectiveContribution {
  readonly agentId: AgentId;
  readonly actorId: string;
  readonly role: string;
  readonly modelId: string;
  readonly providerId: string;
  readonly content: string;
  readonly sourceIds: readonly string[];
  readonly evidenceIds: readonly string[];
}

export interface CollectiveChallenge {
  readonly agentId: AgentId;
  readonly actorId: string;
  readonly round: number;
  readonly modelId: string;
  readonly providerId: string;
  readonly targetAgentIds: readonly AgentId[];
  readonly content: string;
}

export interface CollectiveFailure {
  readonly agentId: AgentId;
  readonly actorId: string;
  readonly error: string;
}

export type CollectiveExecutionStatus = "SUCCEEDED" | "PARTIAL" | "FAILED";

export interface CollectiveExecutionResult {
  readonly collectiveId: string;
  readonly runId: string;
  readonly conversationId: string;
  readonly status: CollectiveExecutionStatus;
  readonly synthesizerAgentId: AgentId;
  readonly contributions: readonly CollectiveContribution[];
  readonly challenges: readonly CollectiveChallenge[];
  readonly failures: readonly CollectiveFailure[];
  readonly sourceIds: readonly string[];
  readonly evidenceIds: readonly string[];
  readonly factChecks?: readonly FactCheckResult[];
  readonly synthesis?: Message;
}

export interface CollectiveOrchestrationDependencies {
  readonly agents: AgentRegistry;
  readonly agentGateway: AgentGateway;
  readonly conversations: ConversationStore;
  readonly messages: MessageStore;
  readonly events: EventStore;
  readonly research?: ResearchService;
  readonly factCheck?: FactCheckService;
  readonly teamPlanner?: (request: AgentTeamPlanningRequest) => AgentTeamPlan;
  readonly agentRuns?: AgentRunService;
  readonly unitOfWork?: DomainUnitOfWork;
}

interface ResearchContext {
  readonly sources: readonly Source[];
  readonly evidence: readonly Evidence[];
}

export class CollectiveOrchestrationService {
  constructor(private readonly dependencies: CollectiveOrchestrationDependencies) {}

  async execute(input: ExecuteCollectiveInput): Promise<CollectiveExecutionResult> {
    const now = input.now ?? (() => new Date().toISOString());
    const maxParticipants = input.maxParticipants ?? DEFAULT_MAX_PARTICIPANTS;
    const targets = this.resolveTargets(input, maxParticipants);
    this.validateInput(input, targets, maxParticipants);
    const synthesizerAgentId = input.synthesizerAgentId ?? targets[targets.length - 1]!.agentId;
    const collectiveId = `collective:${input.command.conversation.id}:${input.command.message.id}`;
    const researchEnabled = input.researchEnabled ?? this.dependencies.research !== undefined;
    const researchSourceLimit = input.researchSourceLimit ?? DEFAULT_RESEARCH_SOURCE_LIMIT;
    const maxChallengeRounds = input.maxChallengeRounds ?? DEFAULT_MAX_CHALLENGE_ROUNDS;

    if (input.factCheckerAgentId !== undefined && this.dependencies.factCheck === undefined) {
      throw new Error("Collective fact checking is enabled but no Fact Check service is configured.");
    }

    if (this.dependencies.agentRuns !== undefined) {
      const existingRun = this.dependencies.agentRuns.get(collectiveId);
      if (existingRun === undefined) {
        this.dependencies.agentRuns.create({
          id: collectiveId,
          userId: input.actorId,
          task: input.command.message.content,
          mode: researchEnabled ? "research" : "deep",
          agentIds: targets.map((target) => target.agentId),
          createdAt: now(),
        });
        this.dependencies.agentRuns.start(collectiveId, now());
      } else if (existingRun.status === "queued") {
        this.dependencies.agentRuns.start(collectiveId, now());
      } else if (existingRun.status !== "running") {
        throw new Error(
          `Collective run already reached terminal state: ${collectiveId}.`,
        );
      }
    }

    const synthesizer = this.dependencies.agents.get(synthesizerAgentId);
    if (synthesizer === undefined || synthesizer.status !== "ACTIVE") {
      throw new Error(`Synthesizer agent is not active: ${synthesizerAgentId}.`);
    }

    if (researchEnabled && this.dependencies.research === undefined) {
      throw new Error("Collective research is enabled but no research provider is configured.");
    }

    const contributors = targets.filter((target) => target.agentId !== synthesizerAgentId);
    this.persistStart(
      collectiveId,
      input,
      synthesizerAgentId,
      now(),
      researchEnabled,
      researchSourceLimit,
      maxChallengeRounds,
      targets,
      input.factCheckerAgentId,
    );

    const researchByAgent = new Map<AgentId, ResearchContext>();
    const researchFailures: CollectiveFailure[] = [];

    if (researchEnabled && this.dependencies.research !== undefined) {
      for (const target of contributors) {
        const agent = this.dependencies.agents.get(target.agentId);
        const role = agent?.role ?? "Generalist";

        try {
          const result = await this.dependencies.research.conduct({
            query: buildResearchQuery(input.command.message.content, role),
            sourceLimit: researchSourceLimit,
            actorId: target.actorId,
            taskId: collectiveId,
            sourceIdFactory: (index, candidate) =>
              "collective-source-" +
              stableId(
                collectiveId +
                  ":" +
                  target.agentId +
                  ":" +
                  index +
                  ":" +
                  candidate.locator +
                  ":" +
                  candidate.retrievedAt,
              ),
            evidenceIdFactory: (index, candidate) =>
              "collective-evidence-" +
              stableId(
                target.agentId +
                  ":" +
                  index +
                  ":" +
                  candidate.locator +
                  ":" +
                  candidate.retrievedAt,
              ),
            now: now(),
          });

          researchByAgent.set(target.agentId, {
            sources: result.sources,
            evidence: result.evidence,
          });
        } catch (error) {
          researchFailures.push({
            agentId: target.agentId,
            actorId: target.actorId,
            error: `Research failed: ${error instanceof Error ? error.message : "Unknown research error."}`,
          });
        }
      }
    }

    const contributorResults = await Promise.all(
      contributors.map(async (target) => {
        const agent = this.dependencies.agents.get(target.agentId);
        const role = agent?.role ?? "Generalist";
        const research = researchByAgent.get(target.agentId) ?? {
          sources: [],
          evidence: [],
        };

        try {
          const response = await this.dependencies.agentGateway.invokeText({
            agentId: target.agentId,
            runId: collectiveId,
            requiredCapabilityIds: input.requiredCapabilityIds,
            request: this.buildContributorRequest(
              input.command.message.content,
              role,
              agent?.name ?? target.agentId,
              research,
              buildAgentRolePrompt(agent, "analysis"),
            ),
          });

          const content = response.output.content.trim().slice(0, MAX_CONTRIBUTION_CHARACTERS);
          if (content === "") {
            throw new Error("Contributor returned empty content.");
          }

          return {
            kind: "success" as const,
            contribution: {
              agentId: target.agentId,
              actorId: target.actorId,
              role,
              modelId: response.modelId,
              providerId: response.providerId,
              content,
              sourceIds: research.sources.map((source) => source.id),
              evidenceIds: research.evidence.map((evidence) => evidence.id),
            },
          };
        } catch (error) {
          return {
            kind: "failure" as const,
            failure: {
              agentId: target.agentId,
              actorId: target.actorId,
              error: error instanceof Error ? error.message : "Agent invocation failed.",
            },
          };
        }
      }),
    );

    const contributions = contributorResults
      .filter(
        (result): result is Extract<(typeof contributorResults)[number], { kind: "success" }> =>
          result.kind === "success",
      )
      .map((result) => result.contribution);

    const failures: CollectiveFailure[] = [
      ...researchFailures,
      ...contributorResults
        .filter(
          (result): result is Extract<(typeof contributorResults)[number], { kind: "failure" }> =>
            result.kind === "failure",
        )
        .map((result) => result.failure),
    ];

    const researchContext = mergeResearchContext([...researchByAgent.values()]);

    const factChecks: FactCheckResult[] = [];
    if (input.factCheckerAgentId !== undefined && this.dependencies.factCheck !== undefined) {
      try {
        const results = await this.dependencies.factCheck.execute({
          runId: collectiveId,
          factCheckerAgentId: input.factCheckerAgentId,
          claims: contributions.map((contribution) => ({
            id: `collective-claim:${collectiveId}:${contribution.agentId}`,
            claim: contribution.content,
            evidenceIds: contribution.evidenceIds,
          })),
          requiredCapabilityIds: input.requiredCapabilityIds,
          now,
        });
        factChecks.push(...results);
      } catch (error) {
        failures.push({
          agentId: input.factCheckerAgentId,
          actorId: input.factCheckerAgentId,
          error:
            error instanceof Error
              ? `Fact check failed: ${error.message}`
              : "Fact check failed.",
        });
      }
    }

    if (
      !Number.isInteger(maxChallengeRounds) ||
      maxChallengeRounds < 0 ||
      maxChallengeRounds > MAX_CHALLENGE_ROUNDS
    ) {
      throw new RangeError("Collective maxChallengeRounds must be an integer between 0 and 2.");
    }

    const challenges: CollectiveChallenge[] = [];

    if (contributions.length === 0) {
      this.persistContributions(collectiveId, input, contributions, failures, now());
      this.persistFailure(
        collectiveId,
        input,
        synthesizerAgentId,
        "No contributor returned a usable result.",
        now(),
      );
      if (this.dependencies.agentRuns !== undefined) {
        this.dependencies.agentRuns.syncMessageIds(collectiveId);
        this.dependencies.agentRuns.fail({
          id: collectiveId,
          error: "No contributor returned a usable result.",
          completedAt: now(),
        });
      }
      return {
        collectiveId,
        runId: collectiveId,
        conversationId: input.command.conversation.id,
        status: "FAILED",
        synthesizerAgentId,
        contributions,
        challenges,
        failures,
        sourceIds: [],
        evidenceIds: [],
        ...(factChecks.length === 0 ? {} : { factChecks }),
      };
    }

    for (let round = 1; round <= maxChallengeRounds; round += 1) {
      const results = await Promise.all(
        targets.map(async (target) => {
          const agent = this.dependencies.agents.get(target.agentId);
          const role = agent?.role ?? "Generalist";
          const targetAgentIds = contributors
            .filter((candidate) => candidate.agentId !== target.agentId)
            .map((candidate) => candidate.agentId);

          try {
            const response = await this.dependencies.agentGateway.invokeText({
              agentId: target.agentId,
              runId: collectiveId,
              requiredCapabilityIds: input.requiredCapabilityIds,
              request: this.buildChallengeRequest(
                input.command.message.content,
                role,
                target.agentId,
                round,
                contributions,
                challenges,
                researchContext,
                buildAgentRolePrompt(agent, "critique"),
              ),
            });

            const content = response.output.content.trim().slice(0, MAX_CONTRIBUTION_CHARACTERS);
            if (content === "") throw new Error("Challenge agent returned empty content.");

            return {
              kind: "success" as const,
              challenge: {
                agentId: target.agentId,
                actorId: target.actorId,
                round,
                modelId: response.modelId,
                providerId: response.providerId,
                targetAgentIds,
                content,
              },
            };
          } catch (error) {
            return {
              kind: "failure" as const,
              failure: {
                agentId: target.agentId,
                actorId: target.actorId,
                error:
                  error instanceof Error
                    ? `Challenge failed: ${error.message}`
                    : "Challenge invocation failed.",
              },
            };
          }
        }),
      );

      const roundChallenges = results
        .filter(
          (result): result is Extract<(typeof results)[number], { kind: "success" }> =>
            result.kind === "success",
        )
        .map((result) => result.challenge);
      const roundFailures = results
        .filter(
          (result): result is Extract<(typeof results)[number], { kind: "failure" }> =>
            result.kind === "failure",
        )
        .map((result) => result.failure);

      challenges.push(...roundChallenges);
      failures.push(...roundFailures);
      this.persistChallenges(collectiveId, input, roundChallenges, roundFailures, now());
    }

    this.persistContributions(collectiveId, input, contributions, [], now());

    let synthesisContent: string;
    let synthesisModelId: string;
    let synthesisProviderId: string;

    try {
      const response = await this.dependencies.agentGateway.invokeText({
        agentId: synthesizerAgentId,
        runId: collectiveId,
        requiredCapabilityIds: input.requiredCapabilityIds,
        request: this.buildSynthesisRequest(
          input.command.message.content,
          contributions,
          challenges,
          failures,
          researchContext,
          factChecks,
          buildAgentRolePrompt(synthesizer, "synthesis"),
        ),
      });
      synthesisContent = response.output.content.trim().slice(0, MAX_CONTRIBUTION_CHARACTERS);
      synthesisModelId = response.modelId;
      synthesisProviderId = response.providerId;
    } catch (error) {
      this.persistFailure(
        collectiveId,
        input,
        synthesizerAgentId,
        error instanceof Error ? error.message : "Synthesis failed.",
        now(),
      );
      if (this.dependencies.agentRuns !== undefined) {
        this.dependencies.agentRuns.syncMessageIds(collectiveId);
        this.dependencies.agentRuns.fail({
          id: collectiveId,
          error: error instanceof Error ? error.message : "Synthesis failed.",
          completedAt: now(),
        });
      }
      return {
        collectiveId,
        runId: collectiveId,
        conversationId: input.command.conversation.id,
        status: "FAILED",
        synthesizerAgentId,
        contributions,
        challenges,
        failures,
        sourceIds: researchContext.sources.map((source) => source.id),
        evidenceIds: researchContext.evidence.map((evidence) => evidence.id),
        ...(factChecks.length === 0 ? {} : { factChecks }),
      };
    }

    if (synthesisContent === "") {
      this.persistFailure(
        collectiveId,
        input,
        synthesizerAgentId,
        "Synthesis agent returned empty content.",
        now(),
      );
      if (this.dependencies.agentRuns !== undefined) {
        this.dependencies.agentRuns.syncMessageIds(collectiveId);
        this.dependencies.agentRuns.fail({
          id: collectiveId,
          error: "Synthesis agent returned empty content.",
          completedAt: now(),
        });
      }
      return {
        collectiveId,
        runId: collectiveId,
        conversationId: input.command.conversation.id,
        status: "FAILED",
        synthesizerAgentId,
        contributions,
        challenges,
        failures,
        sourceIds: researchContext.sources.map((source) => source.id),
        evidenceIds: researchContext.evidence.map((evidence) => evidence.id),
        ...(factChecks.length === 0 ? {} : { factChecks }),
      };
    }

    const synthesis = this.persistSynthesis(
      collectiveId,
      input,
      synthesizerAgentId,
      synthesisContent,
      synthesisModelId,
      synthesisProviderId,
      researchContext,
      now(),
    );

    if (this.dependencies.agentRuns !== undefined) {
      this.dependencies.agentRuns.syncMessageIds(collectiveId);
      this.dependencies.agentRuns.complete({
        id: collectiveId,
        finalAnswer: synthesis.content,
        completedAt: now(),
      });
    }

    return {
      collectiveId,
      runId: collectiveId,
      conversationId: input.command.conversation.id,
      status: failures.length === 0 ? "SUCCEEDED" : "PARTIAL",
      synthesizerAgentId,
      contributions,
      challenges,
      failures,
      sourceIds: researchContext.sources.map((source) => source.id),
      evidenceIds: researchContext.evidence.map((evidence) => evidence.id),
      ...(factChecks.length === 0 ? {} : { factChecks }),
      synthesis,
    };
  }

  private resolveTargets(
    input: ExecuteCollectiveInput,
    maxParticipants: number,
  ): CollectiveTarget[] {
    if (input.targets !== undefined && input.targets.length > 0) {
      return [...input.targets];
    }

    if (this.dependencies.teamPlanner === undefined) {
      throw new RangeError("Collective targets are required when no team planner is configured.");
    }

    const plan = this.dependencies.teamPlanner({
      requiredCapabilityIds: input.requiredCapabilityIds,
      minimumAgents: MIN_PARTICIPANTS,
      maximumAgents: maxParticipants,
      preferProviderDiversity: true,
    });

    return plan.members.map((member) => ({
      agentId: member.agent.id,
      actorId: member.agent.id,
    }));
  }

  private validateInput(
    input: ExecuteCollectiveInput,
    targets: readonly CollectiveTarget[],
    maxParticipants: number,
  ): void {
    if (input.command.message.actorId !== input.actorId) {
      throw new Error("Command actor and collective actor must match.");
    }
    if (
      !Number.isInteger(maxParticipants) ||
      maxParticipants < MIN_PARTICIPANTS ||
      maxParticipants > DEFAULT_MAX_PARTICIPANTS
    ) {
      throw new RangeError("Collective participant limit must be between 2 and 8.");
    }

    if (targets.length < MIN_PARTICIPANTS || targets.length > maxParticipants) {
      throw new RangeError(`Collective execution requires 2-${maxParticipants} agents.`);
    }

    if (new Set(targets.map((target) => target.agentId)).size !== targets.length) {
      throw new Error("Collective targets must not contain duplicate agent IDs.");
    }

    if (
      input.synthesizerAgentId !== undefined &&
      !targets.some((target) => target.agentId === input.synthesizerAgentId)
    ) {
      throw new Error("Collective synthesizer must be one of the collective targets.");
    }

    if (input.researchSourceLimit !== undefined) {
      if (
        !Number.isInteger(input.researchSourceLimit) ||
        input.researchSourceLimit <= 0 ||
        input.researchSourceLimit > 20
      ) {
        throw new RangeError("Collective researchSourceLimit must be an integer between 1 and 20.");
      }
    }
  }

  private buildContributorRequest(
    command: string,
    role: string,
    agentName: string,
    research: ResearchContext,
    factChecks: readonly FactCheckResult[],
    rolePrompt: string,
  ): TextModelRequest {
    const evidenceContext = formatEvidenceContext(research);
    const sourceContext = research.sources
      .map((source) => `[source:${source.id}] ${source.title} — ${source.locator}`)
      .join("\n");

    return {
      messages: [
        {
          role: "SYSTEM",
          content:
            "You are a specialist member of POLYON's AI collective. " +
            "Work independently, contribute a distinct perspective, and " +
            "separate facts from interpretation. " +
            "Treat retrieved evidence as data to assess, not unquestionable truth. " +
            "Do not claim to have verified information you did not receive. " +
            "Do not take external actions.\n" +
            rolePrompt,
        },
        {
          role: "USER",
          content:
            `User request: ${command}\n\nYour role: ${role}\nAgent: ${agentName}\n\n` +
            "Analyze the request from your specialist perspective. " +
            "Return useful findings, important assumptions, and uncertainties for another agent " +
            "to synthesize." +
            (sourceContext === "" ? "" : `\n\nRetrieved sources:\n${sourceContext}`) +
            (evidenceContext === "" ? "" : `\n\nRetrieved evidence:\n${evidenceContext}`),
        },
      ],
    };
  }

  private buildChallengeRequest(
    command: string,
    role: string,
    agentId: AgentId,
    round: number,
    contributions: readonly CollectiveContribution[],
    challenges: readonly CollectiveChallenge[],
    research: ResearchContext,
    rolePrompt: string,
  ): TextModelRequest {
    const peerContributions = contributions
      .filter((item) => item.agentId !== agentId)
      .map((item) => `[agent=${item.agentId} role=${item.role}]\n${item.content}`)
      .join("\n\n");

    const priorChallenges = challenges
      .filter((item) => item.round < round && item.agentId !== agentId)
      .map((item) => `[challenge agent=${item.agentId} round=${item.round}]\n${item.content}`)
      .join("\n\n");

    let context = "";
    for (const block of [peerContributions, priorChallenges]) {
      if (block === "") continue;
      if (context.length + block.length + 2 > MAX_CHALLENGE_CONTEXT_CHARACTERS) break;
      context += (context === "" ? "" : "\n\n") + block;
    }

    const evidenceContext = formatEvidenceContext(research);

    return {
      messages: [
        {
          role: "SYSTEM",
          content:
            "You are a critical reviewer inside POLYON's AI collective. " +
            "Challenge peer reasoning rather than seeking agreement. " +
            "Identify unsupported claims, " +
            "conflicting evidence, hidden assumptions, and plausible alternative explanations. " +
            "Separate facts from interpretations. Do not invent sources or claim verification " +
            "you did not receive. Do not take external actions.\n" +
            rolePrompt,
        },
        {
          role: "USER",
          content:
            `User request: ${command}\n\nYour role: ${role}\nReviewer: ${agentId}\n` +
            `Round: ${round}\n\n` +
            (context === ""
              ? "There are no peer contributions yet. Critically inspect the available evidence " +
                "and assumptions."
              : `Peer contributions:\n${context}`) +
            (evidenceContext === "" ? "" : `\n\nShared evidence:\n${evidenceContext}`) +
            "\n\nReturn the strongest challenges and concrete corrections for the synthesis lead.",
        },
      ],
    };
  }

  private buildSynthesisRequest(
    command: string,
    contributions: readonly CollectiveContribution[],
    challenges: readonly CollectiveChallenge[],
    failures: readonly CollectiveFailure[],
    research: ResearchContext,
    factChecks: readonly FactCheckResult[],
    rolePrompt: string,
  ): TextModelRequest {
    const lines = contributions.map(
      (item) =>
        `[agent=${item.agentId} role=${item.role} model=${item.modelId} ` +
        `provider=${item.providerId}]\n${item.content}`,
    );
    const challengeLines = challenges.map(
      (item) =>
        `[challenge agent=${item.agentId} round=${item.round} targets=${item.targetAgentIds.join(
          ",",
        )}]\n${item.content}`,
    );
    const failureLines = failures.map((item) => `[agent=${item.agentId}] failed: ${item.error}`);
    const evidenceContext = formatEvidenceContext(research);
    const factCheckContext = factChecks
      .map(
        (result) =>
          `[claim=${result.claimId} verdict=${result.verdict} confidence=${result.confidence ?? "n/a"} evidence=${result.evidenceIds.join(",")}]
${result.rationale}`,
      )
      .join("\n\n");

    let context = "";
    for (const line of [
      ...lines,
      ...challengeLines,
      ...(factCheckContext === "" ? [] : [`Fact-check results:\n${factCheckContext}`]),
      ...failureLines,
    ]) {
      if (context.length + line.length + 2 > MAX_SYNTHESIS_CONTEXT_CHARACTERS) break;
      context += (context === "" ? "" : "\n\n") + line;
    }

    return {
      messages: [
        {
          role: "SYSTEM",
          content:
            "You are POLYON's synthesis lead. Produce one transparent answer from " +
            "the collective. Do not treat agent agreement as proof. Distinguish " +
            "directly supported facts, source-backed evidence, agent interpretations, " +
            "disagreements, missing information, and uncertainty. " +
            "Never invent sources or verification. " +
            "Prefer a useful conclusion with explicit caveats.\n" +
            rolePrompt,
        },
        {
          role: "USER",
          content:
            `User request: ${command}\n\nCollective findings and challenges:\n${context}` +
            (evidenceContext === "" ? "" : `\n\nShared evidence:\n${evidenceContext}`) +
            "\n\nFormat the response with these sections: Findings, Evidence, Agreements, " +
            "Disagreements, Counterclaims, Uncertainty, Conclusion.",
        },
      ],
    };
  }

  private persistStart(
    collectiveId: string,
    input: ExecuteCollectiveInput,
    synthesizerAgentId: AgentId,
    occurredAt: string,
    researchEnabled: boolean,
    researchSourceLimit: number,
    maxChallengeRounds: number,
    targets: readonly CollectiveTarget[],
    factCheckerAgentId?: AgentId,
  ): void {
    this.withStores((stores) => {
      stores.events.append({
        id: `COLLECTIVE_STARTED:${collectiveId}`,
        kind: "COLLECTIVE_STARTED",
        actorId: input.actorId,
        conversationId: input.command.conversation.id,
        occurredAt,
        data: {
          collectiveId,
          participantAgentIds: targets.map((target) => target.agentId),
          synthesizerAgentId,
          commandMessageId: input.command.message.id,
          researchEnabled,
          researchSourceLimit,
          maxChallengeRounds,
          ...(factCheckerAgentId === undefined ? {} : { factCheckerAgentId }),
        },
      });
    });
  }

  private persistContributions(
    collectiveId: string,
    input: ExecuteCollectiveInput,
    contributions: readonly CollectiveContribution[],
    failures: readonly CollectiveFailure[],
    occurredAt: string,
  ): void {
    this.withStores((stores) => {
      for (const contribution of contributions) {
        const messageId = `collective:${collectiveId}:agent:${contribution.agentId}`;
        const messageExists = stores.messages.get(messageId) !== undefined;
        if (!messageExists) {
          stores.messages.save({
            id: messageId,
            conversationId: input.command.conversation.id,
            actorId: contribution.actorId,
            role: "AGENT",
            kind: "TEXT",
            content: contribution.content,
            runId: collectiveId,
            fromAgentId: contribution.agentId,
            agentMessageType: "finding",
            payload: {
              agentId: contribution.agentId,
              role: contribution.role,
              modelId: contribution.modelId,
              providerId: contribution.providerId,
              sourceIds: [...contribution.sourceIds],
              evidenceIds: [...contribution.evidenceIds],
            },
            createdAt: occurredAt,
          });
        }

        if (stores.events.get(`AGENT_MESSAGE_CREATED:${messageId}`) === undefined) {
          stores.events.append({
            id: `AGENT_MESSAGE_CREATED:${messageId}`,
            kind: "AGENT_MESSAGE_CREATED",
            actorId: contribution.actorId,
            conversationId: input.command.conversation.id,
            occurredAt,
            data: {
              messageId,
              runId: collectiveId,
              fromAgentId: contribution.agentId,
              agentMessageType: "finding",
            },
          });
        }

        stores.events.append({
          id: `COLLECTIVE_CONTRIBUTION:${collectiveId}:${contribution.agentId}`,
          kind: "COLLECTIVE_CONTRIBUTION",
          actorId: contribution.actorId,
          conversationId: input.command.conversation.id,
          occurredAt,
          data: {
            collectiveId,
            agentId: contribution.agentId,
            role: contribution.role,
            modelId: contribution.modelId,
            providerId: contribution.providerId,
            status: "SUCCEEDED",
            messageId,
            sourceIds: [...contribution.sourceIds],
            evidenceIds: [...contribution.evidenceIds],
          },
        });
      }

      for (const failure of failures) {
        stores.events.append({
          id:
            `COLLECTIVE_CONTRIBUTION:${collectiveId}:${failure.agentId}:` + stableId(failure.error),
          kind: "COLLECTIVE_CONTRIBUTION",
          actorId: failure.actorId,
          conversationId: input.command.conversation.id,
          occurredAt,
          data: {
            collectiveId,
            agentId: failure.agentId,
            status: "FAILED",
            error: failure.error,
          },
        });
      }

      const conversation = stores.conversations.get(input.command.conversation.id);
      if (conversation === undefined) {
        throw new Error(`Conversation not found: ${input.command.conversation.id}.`);
      }

      const contributionMessageIds = contributions.map(
        (contribution) => `collective:${collectiveId}:agent:${contribution.agentId}`,
      );
      stores.conversations.save({
        ...conversation,
        messageIds: [
          ...conversation.messageIds,
          ...contributionMessageIds.filter((id) => !conversation.messageIds.includes(id)),
        ],
        updatedAt: occurredAt,
      });
    });
  }

  private persistChallenges(
    collectiveId: string,
    input: ExecuteCollectiveInput,
    challenges: readonly CollectiveChallenge[],
    failures: readonly CollectiveFailure[],
    occurredAt: string,
  ): void {
    this.withStores((stores) => {
      for (const challenge of challenges) {
        const messageId = `collective:${collectiveId}:challenge:${challenge.round}:${challenge.agentId}`;
        const messageExists = stores.messages.get(messageId) !== undefined;
        if (!messageExists) {
          stores.messages.save({
            id: messageId,
            conversationId: input.command.conversation.id,
            actorId: challenge.actorId,
            role: "AGENT",
            kind: "TEXT",
            content: challenge.content,
            runId: collectiveId,
            fromAgentId: challenge.agentId,
            agentMessageType: "challenge",
            payload: {
              agentId: challenge.agentId,
              round: challenge.round,
              modelId: challenge.modelId,
              providerId: challenge.providerId,
              targetAgentIds: [...challenge.targetAgentIds],
            },
            createdAt: occurredAt,
          });
        }

        if (stores.events.get(`AGENT_MESSAGE_CREATED:${messageId}`) === undefined) {
          stores.events.append({
            id: `AGENT_MESSAGE_CREATED:${messageId}`,
            kind: "AGENT_MESSAGE_CREATED",
            actorId: challenge.actorId,
            conversationId: input.command.conversation.id,
            occurredAt,
            data: {
              messageId,
              runId: collectiveId,
              fromAgentId: challenge.agentId,
              agentMessageType: "challenge",
              toAgentIds: [...challenge.targetAgentIds],
            },
          });
        }

        stores.events.append({
          id: `COLLECTIVE_CHALLENGE:${collectiveId}:r${challenge.round}:${challenge.agentId}`,
          kind: "COLLECTIVE_CHALLENGE",
          actorId: challenge.actorId,
          conversationId: input.command.conversation.id,
          occurredAt,
          data: {
            collectiveId,
            agentId: challenge.agentId,
            round: challenge.round,
            modelId: challenge.modelId,
            providerId: challenge.providerId,
            targetAgentIds: [...challenge.targetAgentIds],
            messageId,
            status: "SUCCEEDED",
          },
        });
      }

      for (const failure of failures) {
        stores.events.append({
          id: `COLLECTIVE_CHALLENGE:${collectiveId}:${failure.agentId}:${stableId(failure.error)}`,
          kind: "COLLECTIVE_CHALLENGE",
          actorId: failure.actorId,
          conversationId: input.command.conversation.id,
          occurredAt,
          data: {
            collectiveId,
            agentId: failure.agentId,
            status: "FAILED",
            error: failure.error,
          },
        });
      }

      const conversation = stores.conversations.get(input.command.conversation.id);
      if (conversation === undefined) {
        throw new Error(`Conversation not found: ${input.command.conversation.id}.`);
      }

      const challengeMessageIds = challenges.map(
        (challenge) =>
          `collective:${collectiveId}:challenge:${challenge.round}:${challenge.agentId}`,
      );
      stores.conversations.save({
        ...conversation,
        messageIds: [
          ...conversation.messageIds,
          ...challengeMessageIds.filter((id) => !conversation.messageIds.includes(id)),
        ],
        updatedAt: occurredAt,
      });
    });
  }

  private persistSynthesis(
    collectiveId: string,
    input: ExecuteCollectiveInput,
    synthesizerAgentId: AgentId,
    content: string,
    modelId: string,
    providerId: string,
    research: ResearchContext,
    occurredAt: string,
  ): Message {
    const message: Message = {
      id: `collective:${collectiveId}:synthesis`,
      conversationId: input.command.conversation.id,
      actorId: synthesizerAgentId,
      role: "AGENT",
      kind: "TEXT",
      content,
      runId: collectiveId,
      fromAgentId: synthesizerAgentId,
      agentMessageType: "decision",
      payload: {
        synthesizerAgentId,
        modelId,
        providerId,
        sourceIds: research.sources.map((source) => source.id),
        evidenceIds: research.evidence.map((evidence) => evidence.id),
      },
      createdAt: occurredAt,
    };

    this.withStores((stores) => {
      if (stores.messages.get(message.id) === undefined) {
        stores.messages.save(message);
      }

      const conversation = stores.conversations.get(input.command.conversation.id);
      if (conversation === undefined) {
        throw new Error(`Conversation not found: ${input.command.conversation.id}.`);
      }

      if (!conversation.messageIds.includes(message.id)) {
        stores.conversations.save({
          ...conversation,
          messageIds: [...conversation.messageIds, message.id],
          updatedAt: occurredAt,
        });
      }

      if (stores.events.get(`AGENT_MESSAGE_CREATED:${message.id}`) === undefined) {
        stores.events.append({
          id: `AGENT_MESSAGE_CREATED:${message.id}`,
          kind: "AGENT_MESSAGE_CREATED",
          actorId: synthesizerAgentId,
          conversationId: message.conversationId,
          occurredAt,
          data: {
            messageId: message.id,
            runId: collectiveId,
            fromAgentId: synthesizerAgentId,
            agentMessageType: "decision",
            synthesis: true,
          },
        });
      }

      const event: DomainEvent = {
        id: `COLLECTIVE_SYNTHESIZED:${collectiveId}`,
        kind: "COLLECTIVE_SYNTHESIZED",
        actorId: synthesizerAgentId,
        conversationId: message.conversationId,
        occurredAt,
        data: {
          collectiveId,
          synthesizerAgentId,
          synthesisMessageId: message.id,
          modelId,
          providerId,
          sourceIds: research.sources.map((source) => source.id),
          evidenceIds: research.evidence.map((evidence) => evidence.id),
        },
      };
      stores.events.append(event);
    });

    return message;
  }

  private persistFailure(
    collectiveId: string,
    input: ExecuteCollectiveInput,
    synthesizerAgentId: AgentId,
    error: string,
    occurredAt: string,
  ): void {
    this.withStores((stores) => {
      stores.events.append({
        id: `ERROR:COLLECTIVE:${collectiveId}:${occurredAt}:${synthesizerAgentId}`,
        kind: "ERROR",
        actorId: synthesizerAgentId,
        conversationId: input.command.conversation.id,
        occurredAt,
        data: {
          collectiveId,
          subsystem: "COLLECTIVE_ORCHESTRATION",
          error,
        },
      });
    });
  }

  private withStores<T>(
    work: (stores: {
      readonly conversations: ConversationStore;
      readonly messages: MessageStore;
      readonly events: EventStore;
    }) => T,
  ): T {
    if (this.dependencies.unitOfWork === undefined) {
      return work(this.dependencies);
    }

    return this.dependencies.unitOfWork.transaction(work);
  }
}

function buildResearchQuery(command: string, role: string): string {
  return `${command.trim()}\nFocus your research on your role as ${role}.`;
}

function formatEvidenceContext(research: ResearchContext): string {
  const sourcesById = new Map(research.sources.map((source) => [source.id, source]));
  const lines: string[] = [];
  let total = 0;

  for (const item of research.evidence) {
    const source = sourcesById.get(item.sourceId);
    const line =
      `[evidence:${item.id} source:${item.sourceId} ${source?.title ?? "unknown"}]` +
      ` ${item.kind}: ${item.claim}\n${item.supportingContent}`;

    if (total + line.length > MAX_EVIDENCE_CONTEXT_CHARACTERS) break;
    lines.push(line);
    total += line.length + 2;
  }

  return lines.join("\n\n");
}

function mergeResearchContext(contexts: readonly ResearchContext[]): ResearchContext {
  const sources = new Map<string, Source>();
  const evidence = new Map<string, Evidence>();

  for (const context of contexts) {
    for (const source of context.sources) sources.set(source.id, source);
    for (const item of context.evidence) evidence.set(item.id, item);
  }

  return {
    sources: [...sources.values()],
    evidence: [...evidence.values()],
  };
}

function stableId(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
