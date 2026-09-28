import type { Artifact, ArtifactKind, DomainEvent } from "@polyon/contracts";
import type {
  ArtifactStore,
  DomainStoreTransactionContext,
  DomainUnitOfWork,
  EventStore,
} from "@polyon/storage";

export type CreativeOperation = "IMAGE" | "VIDEO" | "AUDIO" | "VOICE" | "EDIT";

export interface CreativeJobRequest {
  readonly id: string;
  readonly operation: CreativeOperation;
  readonly prompt: string;
  readonly outputKind: Extract<ArtifactKind, "IMAGE" | "VIDEO" | "AUDIO" | "CODE" | "DOCUMENT">;
  readonly artifactId: string;
  readonly artifactName: string;
  readonly location: string;
  readonly mimeType?: string;
  readonly missionId?: string;
  readonly taskId?: string;
  readonly createdAt: string;
}

export interface CreativeAdapter {
  generate(
    request: CreativeJobRequest,
    signal?: AbortSignal,
  ): Promise<{
    readonly artifact: Omit<Artifact, "id" | "createdAt" | "updatedAt">;
  }>;
}

export class CreativeJobService {
  constructor(
    private readonly adapter: CreativeAdapter,
    private readonly artifacts: ArtifactStore,
    private readonly events: EventStore,
    private readonly unitOfWork?: DomainUnitOfWork,
  ) {}

  async run(request: CreativeJobRequest, signal?: AbortSignal): Promise<Artifact> {
    validateCreativeRequest(request);

    const output = await this.adapter.generate(request, signal);
    if (output.artifact.kind !== request.outputKind) {
      throw new Error(
        "Creative adapter returned an artifact kind that does not match the requested output.",
      );
    }
    if (output.artifact.status !== "AVAILABLE" && output.artifact.status !== "CREATING") {
      throw new Error("Creative adapter returned an invalid artifact status.");
    }
    const artifact: Artifact = {
      ...output.artifact,
      id: request.artifactId,
      createdAt: request.createdAt,
      updatedAt: request.createdAt,
    };

    const operation = (stores: Pick<DomainStoreTransactionContext, "artifacts" | "events">) => {
      if (stores.artifacts.get(artifact.id) !== undefined) {
        throw new Error(`Creative artifact already exists: ${artifact.id}.`);
      }
      stores.artifacts.save(artifact);
      const event: DomainEvent = {
        id: `CREATIVE_ARTIFACT_CREATED:${artifact.id}`,
        kind: "ARTIFACT_CREATED",
        missionId: artifact.missionId,
        taskId: artifact.taskId,
        occurredAt: artifact.createdAt,
        data: {
          artifactId: artifact.id,
          creativeOperation: request.operation,
          location: artifact.location,
          mimeType: artifact.mimeType,
        },
      };
      stores.events.append(event);
    };

    if (this.unitOfWork === undefined) {
      operation({ artifacts: this.artifacts, events: this.events });
    } else {
      this.unitOfWork.transaction(operation);
    }

    return artifact;
  }
}

function validateCreativeRequest(request: CreativeJobRequest): void {
  if (request.id.trim() === "" || request.artifactId.trim() === "") {
    throw new RangeError("Creative request IDs must not be empty.");
  }
  if (request.prompt.trim() === "") throw new RangeError("Creative prompt must not be empty.");
  if (request.prompt.length > 50_000)
    throw new RangeError("Creative prompt exceeds the 50000-character limit.");
  if (request.artifactName.trim() === "")
    throw new RangeError("Creative artifactName must not be empty.");
  if (request.location.trim() === "")
    throw new RangeError("Creative artifact location must not be empty.");
  if (!Number.isFinite(Date.parse(request.createdAt)))
    throw new RangeError("Creative createdAt must be a valid timestamp.");
}
