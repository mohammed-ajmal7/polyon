import type { Model, ModelId } from "@polyon/contracts";

export type ModelRegistryErrorKind = "MODEL_ALREADY_EXISTS";

export class ModelRegistryError extends Error {
  readonly kind: ModelRegistryErrorKind;
  readonly modelId: ModelId;

  constructor(kind: ModelRegistryErrorKind, modelId: ModelId) {
    super(`Model already exists in registry: ${modelId}.`);
    this.name = "ModelRegistryError";
    this.kind = kind;
    this.modelId = modelId;
  }
}

export interface ModelRegistry {
  register(model: Model): void;
  get(modelId: ModelId): Model | undefined;
  list(): readonly Model[];
}

function cloneModel(model: Model): Model {
  return {
    ...model,
    capabilityIds: [...model.capabilityIds],
  };
}

export class InMemoryModelRegistry implements ModelRegistry {
  private readonly models = new Map<ModelId, Model>();

  register(model: Model): void {
    if (this.models.has(model.id)) {
      throw new ModelRegistryError("MODEL_ALREADY_EXISTS", model.id);
    }

    this.models.set(model.id, cloneModel(model));
  }

  get(modelId: ModelId): Model | undefined {
    const model = this.models.get(modelId);

    return model === undefined ? undefined : cloneModel(model);
  }

  list(): readonly Model[] {
    return [...this.models.values()].map(cloneModel);
  }
}
