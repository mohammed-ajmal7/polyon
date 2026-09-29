import type { AgentId, DomainEvent, Mission, Task, TaskKind } from "@polyon/contracts";
import { validateTaskGraph } from "@polyon/core";
import { buildAgentRolePrompt, type AgentGateway } from "@polyon/agents";
import type {
  DomainStoreTransactionContext,
  DomainUnitOfWork,
  EventStore,
  TaskStore,
} from "@polyon/storage";

import { extractJsonObject } from "./structured-finding-parser";

const MAX_TASKS = 20;
const MAX_TITLE = 300;
const MAX_DESCRIPTION = 10_000;
const MAX_DEPENDENCIES = 10;
const MAX_RATIONALE = 10_000;
const MAX_VALIDATION_REPAIR_ATTEMPTS = 1;

export interface GeneratedTaskSpec {
  readonly id: string;
  readonly kind: TaskKind;
  readonly title: string;
  readonly description: string;
  readonly dependsOn: readonly string[];
}

export interface GenerateMissionPlanInput {
  readonly mission: Mission;
  readonly planningAgentId: AgentId;
  readonly requiredCapabilityIds: readonly string[];
  readonly now: string;
  readonly signal?: AbortSignal;
}

export interface GeneratedMissionPlan {
  readonly rationale: string;
  readonly tasks: readonly Task[];
  readonly event: DomainEvent;
}

export class MissionPlanningService {
  constructor(
    private readonly agentGateway: AgentGateway,
    private readonly tasks: TaskStore,
    private readonly events: EventStore,
    private readonly unitOfWork?: DomainUnitOfWork,
  ) {}

  async generate(input: GenerateMissionPlanInput): Promise<GeneratedMissionPlan> {
    validateMission(input.mission);

    const initialResponse = await this.agentGateway.invokeText({
      agentId: input.planningAgentId,
      requiredCapabilityIds: input.requiredCapabilityIds,
      request: {
        messages: [
          {
            role: "SYSTEM",
            content:
              "You are POLYON's planning agent. Return ONLY valid JSON with this exact shape: " +
              '{"rationale":"string","tasks":[{"id":"string","kind":"RESEARCH|ANALYSIS|CODING|CREATIVE|VALIDATION|OTHER","title":"string","description":"string","dependsOn":["task-id"]}]}. ' +
              "Create a finite task graph for the mission. Every dependsOn value MUST exactly match an id declared in the same tasks array. " +
              "Use only the local task ids from that response, never mission-prefixed ids. " +
              "Keep dependencies acyclic. Use an empty dependsOn array when a dependency is not necessary. Never invent capabilities, tools, credentials, or external actions. " +
              "Each task id must be unique and each dependency must appear at most once.\n" +
              "Before returning, mentally verify: all dependency ids exist, no task depends on itself, and the graph has no cycle.\n" +
              buildAgentRolePrompt(undefined, "planning", "planner"),
          },
          {
            role: "USER",
            content: JSON.stringify({
              missionId: input.mission.id,
              objective: input.mission.objective,
              constraints: input.mission.constraints,
              maxTasks: MAX_TASKS,
            }),
          },
        ],
      },
    });

    let proposal: ReturnType<typeof parseGeneratedPlan> | undefined;
    let generatedTasks: Task[] | undefined;
    let validation: ReturnType<typeof validateTaskGraph> | undefined;
    let lastPlanningError: Error | undefined;
    let response = initialResponse;

    for (let attempt = 0; attempt <= MAX_VALIDATION_REPAIR_ATTEMPTS; attempt += 1) {
      try {
        proposal = parseGeneratedPlan(response.output.content);
        generatedTasks = buildGeneratedTasks(input, proposal.tasks);
        validation = validateTaskGraph(generatedTasks);

        if (validation.valid) {
          break;
        }

        lastPlanningError = new MissionPlanningValidationError(validation.errors);
      } catch (error) {
        lastPlanningError =
          error instanceof Error ? error : new Error("Generated mission plan was invalid.");
      }

      if (attempt >= MAX_VALIDATION_REPAIR_ATTEMPTS) {
        break;
      }

      response = await this.agentGateway.invokeText({
        agentId: input.planningAgentId,
        requiredCapabilityIds: input.requiredCapabilityIds,
        request: {
          messages: [
            {
              role: "SYSTEM",
              content:
                "You are repairing a POLYON mission plan. Return ONLY valid JSON with this exact shape: " +
                '{"rationale":"string","tasks":[{"id":"string","kind":"RESEARCH|ANALYSIS|CODING|CREATIVE|VALIDATION|OTHER","title":"string","description":"string","dependsOn":["task-id"]}]}. ' +
                "Correct every reported plan-validation error. Every dependsOn value MUST exactly match an id in the same response. " +
                `Never exceed ${MAX_DEPENDENCIES} dependencies on any task. Never use mission-prefixed ids, task titles, or invented ids as dependencies. ` +
                "Keep the graph acyclic; use [] when a dependency is not necessary. " +
                `Keep task count between 1 and ${MAX_TASKS}, preserve the mission intent, and do not invent capabilities, tools, credentials, or external actions. `,
            },
            {
              role: "USER",
              content: JSON.stringify({
                missionId: input.mission.id,
                objective: input.mission.objective,
                constraints: input.mission.constraints,
                maxTasks: MAX_TASKS,
                maxDependenciesPerTask: MAX_DEPENDENCIES,
                previousPlan: proposal ?? null,
                validationError: lastPlanningError?.message ?? "Unknown plan validation failure.",
                validationErrors: validation?.errors ?? [],
              }),
            },
          ],
        },
      });
    }

    if (proposal === undefined || generatedTasks === undefined || validation === undefined) {
      throw lastPlanningError ?? new Error("Generated mission plan was invalid.");
    }

    if (!validation.valid) {
      throw new MissionPlanningValidationError(validation.errors);
    }

    const event: DomainEvent = {
      id: `MISSION_PLAN_GENERATED:${input.mission.id}:${input.now}`,
      kind: "MISSION_PLAN_GENERATED",
      actorId: input.planningAgentId,
      missionId: input.mission.id,
      occurredAt: input.now,
      data: {
        taskCount: generatedTasks.length,
        taskIds: generatedTasks.map((task) => task.id),
      },
    };

    const operation = (stores: Pick<DomainStoreTransactionContext, "tasks" | "events">) => {
      for (const task of generatedTasks) {
        if (stores.tasks.get(task.id) !== undefined) {
          throw new Error(`Generated task already exists: ${task.id}.`);
        }
        stores.tasks.save(task);
      }
      stores.events.append(event);
    };

    if (this.unitOfWork === undefined) {
      operation({ tasks: this.tasks, events: this.events });
    } else {
      this.unitOfWork.transaction(operation);
    }

    return {
      rationale: proposal.rationale,
      tasks: generatedTasks,
      event,
    };
  }
}

export class MissionPlanningValidationError extends Error {
  readonly errors: ReturnType<typeof validateTaskGraph>["errors"];

  constructor(errors: ReturnType<typeof validateTaskGraph>["errors"]) {
    super("Generated mission plan failed deterministic task-graph validation.");
    this.name = "MissionPlanningValidationError";
    this.errors = errors;
  }
}

function buildGeneratedTasks(
  input: GenerateMissionPlanInput,
  tasks: readonly GeneratedTaskSpec[],
): Task[] {
  return tasks.map((task) => ({
    id: missionTaskId(input.mission.id, task.id),
    missionId: input.mission.id,
    kind: task.kind,
    title: task.title,
    description: task.description,
    status: "PENDING" as const,
    dependsOn: task.dependsOn.map((dependencyId) => missionTaskId(input.mission.id, dependencyId)),
    createdAt: input.now,
    updatedAt: input.now,
  }));
}

function validateMission(mission: Mission): void {
  if (mission.status !== "PLANNING" && mission.status !== "DRAFT") {
    throw new Error(`Mission ${mission.id} is not in a planning state.`);
  }
  if (mission.objective.trim() === "") {
    throw new RangeError("Mission objective must not be empty.");
  }
  if (mission.objective.length > 50_000) {
    throw new RangeError("Mission objective exceeds the planning limit.");
  }
  if (mission.constraints.length > 50) {
    throw new RangeError("Mission cannot contain more than 50 constraints.");
  }
}

function parseGeneratedPlan(content: string): {
  readonly rationale: string;
  readonly tasks: readonly GeneratedTaskSpec[];
} {
  // Tolerates ```json fences and surrounding prose like the other model-output parsers.
  const parsed = extractJsonObject(content);
  if (parsed === undefined) {
    throw new Error("Planning model must return a valid JSON object.");
  }

  const rationale = readBoundedString(parsed.rationale, MAX_RATIONALE, "rationale");
  const rawTasks = parsed.tasks;
  if (!Array.isArray(rawTasks) || rawTasks.length === 0 || rawTasks.length > MAX_TASKS) {
    throw new Error("Planning model must return between 1 and 20 tasks.");
  }

  const ids = new Set<string>();
  const tasks: GeneratedTaskSpec[] = [];
  for (const rawTask of rawTasks) {
    if (!isRecord(rawTask)) throw new Error("Every generated task must be an object.");
    const id = readBoundedId(rawTask.id, "task id");
    if (ids.has(id)) throw new Error(`Generated task id is duplicated: ${id}.`);
    ids.add(id);

    const kind = parseTaskKind(rawTask.kind);
    const title = readBoundedString(rawTask.title, MAX_TITLE, "task title");
    const description = readBoundedString(rawTask.description, MAX_DESCRIPTION, "task description");
    const dependsOnValue = rawTask.dependsOn;
    if (!Array.isArray(dependsOnValue) || dependsOnValue.length > MAX_DEPENDENCIES) {
      throw new Error(`Task ${id} must contain at most ${MAX_DEPENDENCIES} dependencies.`);
    }
    const dependsOn = dependsOnValue.map((dependency) =>
      readBoundedId(dependency, "dependency id"),
    );
    tasks.push({ id, kind, title, description, dependsOn });
  }

  return { rationale, tasks };
}

function missionTaskId(missionId: string, taskId: string): string {
  return `${missionId}:task:${taskId}`;
}

function readBoundedId(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{1,120}$/.test(value)) {
    throw new Error(`Generated ${field} is invalid.`);
  }
  return value;
}

function readBoundedString(value: unknown, max: number, field: string): string {
  if (typeof value !== "string" || value.trim() === "")
    throw new Error(`Generated ${field} must not be empty.`);
  if (Array.from(value).length > max) throw new Error(`Generated ${field} exceeds its bound.`);
  return value.trim();
}

function parseTaskKind(value: unknown): TaskKind {
  if (
    value === "RESEARCH" ||
    value === "ANALYSIS" ||
    value === "CODING" ||
    value === "CREATIVE" ||
    value === "VALIDATION" ||
    value === "OTHER"
  ) {
    return value;
  }
  throw new Error("Generated task kind is invalid.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
