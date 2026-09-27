import type { AgentId, CapabilityId, ModelId, ProviderId } from "@polyon/contracts";

import { ModelGateway, type ModelInvocationOptions } from "@polyon/providers";

import { resolveAgentModel, type AgentModelResolution } from "./agent-model-routing";
import type { AgentRegistry } from "./agent-registry";
import type { ModelRegistry } from "./model-registry";
import type { ProviderRegistry } from "./provider-registry";

export interface AgentGatewayDependencies {
  readonly agents: AgentRegistry;
  readonly models: ModelRegistry;
  readonly providers: ProviderRegistry;
  readonly modelGateway: ModelGateway;
}

export interface AgentGatewayInvocationInput<TInput = unknown> {
  readonly agentId: AgentId;
  readonly requiredCapabilityIds: readonly CapabilityId[];
  readonly input: TInput;
  readonly modelOptions?: ModelInvocationOptions;
}

export interface AgentGatewayInvocationResult<TOutput = unknown> {
  readonly agentId: AgentId;
  readonly modelId: ModelId;
  readonly providerId: ProviderId;
  readonly source: AgentModelResolution["source"];
  readonly output: TOutput;
}

export class AgentGateway {
  constructor(private readonly dependencies: AgentGatewayDependencies) {}

  async invoke<TInput = unknown, TOutput = unknown>(
    input: AgentGatewayInvocationInput<TInput>,
  ): Promise<AgentGatewayInvocationResult<TOutput>> {
    const resolution = resolveAgentModel(
      {
        agentId: input.agentId,
        requiredCapabilityIds: input.requiredCapabilityIds,
      },
      {
        agents: this.dependencies.agents,
        models: this.dependencies.models,
        providers: this.dependencies.providers,
      },
    );

    const result = await this.dependencies.modelGateway.invoke<TInput, TOutput>(
      resolution.model.id,
      input.input,
      input.modelOptions,
    );

    return {
      agentId: resolution.agent.id,
      modelId: resolution.model.id,
      providerId: resolution.provider.id,
      source: resolution.source,
      output: result.output,
    };
  }
}
