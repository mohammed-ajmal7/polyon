import type {
  AgentId,
  CapabilityId,
  ModelId,
  ProviderId,
  TextModelRequest,
  TextModelResponse,
} from "@polyon/contracts";

import {
  ModelGateway,
  ProviderInvocationError,
  type ModelInvocationOptions,
} from "@polyon/providers";

import {
  routeAgentModel,
  type ModelRoutingRequest,
  type ProviderHealth,
} from "./model-routing";
import { ProviderHealthTracker } from "./provider-health";
import type { AgentRegistry } from "./agent-registry";
import type { ModelRegistry } from "./model-registry";
import type { ProviderRegistry } from "./provider-registry";

export interface AgentGatewayDependencies {
  readonly agents: AgentRegistry;
  readonly models: ModelRegistry;
  readonly providers: ProviderRegistry;
  readonly modelGateway: ModelGateway;
  readonly providerHealth?: ProviderHealthTracker;
}

export interface AgentGatewayRoutingOptions {
  readonly privacyClass?: "local" | "cloud";
  readonly allowPaidModels?: boolean;
  readonly minimumContextWindow?: number;
  readonly requireTools?: boolean;
}

export interface AgentGatewayInvocationInput<TInput = unknown> {
  readonly agentId: AgentId;
  readonly requiredCapabilityIds: readonly CapabilityId[];
  readonly input: TInput;
  readonly modelOptions?: ModelInvocationOptions;
  readonly routing?: AgentGatewayRoutingOptions;
}

export interface AgentGatewayInvocationResult<TOutput = unknown> {
  readonly agentId: AgentId;
  readonly modelId: ModelId;
  readonly providerId: ProviderId;
  readonly source: "PREFERRED" | "FALLBACK";
  readonly output: TOutput;
}

export interface AgentGatewayTextInvocationInput {
  readonly agentId: AgentId;
  readonly requiredCapabilityIds: readonly CapabilityId[];
  readonly request: TextModelRequest;
  readonly modelOptions?: ModelInvocationOptions;
  readonly routing?: AgentGatewayRoutingOptions;
}

export class AgentGateway {
  private readonly providerHealth: ProviderHealthTracker;

  constructor(private readonly dependencies: AgentGatewayDependencies) {
    this.providerHealth = dependencies.providerHealth ?? new ProviderHealthTracker();
  }

  healthSnapshot(): Readonly<Record<ProviderId, ProviderHealth>> {
    return this.providerHealth.snapshot();
  }

  async invokeText(
    input: AgentGatewayTextInvocationInput,
  ): Promise<AgentGatewayInvocationResult<TextModelResponse>> {
    return this.invokeWithFailover(
      input.agentId,
      input.requiredCapabilityIds,
      input.routing,
      input.modelOptions,
      (modelId) => this.dependencies.modelGateway.invokeText(modelId, input.request, input.modelOptions),
    );
  }

  async invoke<TInput = unknown, TOutput = unknown>(
    input: AgentGatewayInvocationInput<TInput>,
  ): Promise<AgentGatewayInvocationResult<TOutput>> {
    return this.invokeWithFailover(
      input.agentId,
      input.requiredCapabilityIds,
      input.routing,
      input.modelOptions,
      (modelId) =>
        this.dependencies.modelGateway.invoke<TInput, TOutput>(
          modelId,
          input.input,
          input.modelOptions,
        ),
    );
  }

  private async invokeWithFailover<TOutput>(
    agentId: AgentId,
    requiredCapabilityIds: readonly CapabilityId[],
    routingOptions: AgentGatewayRoutingOptions | undefined,
    modelOptions: ModelInvocationOptions | undefined,
    invokeModel: (modelId: ModelId) => Promise<{ output: TOutput }>,
  ): Promise<AgentGatewayInvocationResult<TOutput>> {
    let failedProviderId: ProviderId | undefined;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const request: ModelRoutingRequest = {
        agentId,
        requiredCapabilityIds,
        ...(routingOptions?.privacyClass === undefined
          ? {}
          : { privacyClass: routingOptions.privacyClass }),
        ...(routingOptions?.allowPaidModels === undefined
          ? {}
          : { allowPaidModels: routingOptions.allowPaidModels }),
        ...(routingOptions?.minimumContextWindow === undefined
          ? {}
          : { minimumContextWindow: routingOptions.minimumContextWindow }),
        ...(routingOptions?.requireTools === undefined
          ? {}
          : { requireTools: routingOptions.requireTools }),
        providerHealth: this.providerHealth.snapshot(),
      };

      const route = routeAgentModel(request, {
        agents: this.dependencies.agents,
        models: this.dependencies.models,
        providers: this.dependencies.providers,
      });

      if (failedProviderId !== undefined && route.provider.id === failedProviderId) {
        throw new Error(
          `Provider failover did not select an alternative provider for agent: ${agentId}.`,
        );
      }

      try {
        const result = await invokeModel(route.model.id);
        this.providerHealth.recordSuccess(route.provider.id);

        return {
          agentId: route.agent.id,
          modelId: route.model.id,
          providerId: route.provider.id,
          source: route.source,
          output: result.output,
        };
      } catch (error) {
        if (!(error instanceof ProviderInvocationError)) {
          throw error;
        }

        this.providerHealth.recordFailure(error.providerId, error.kind);
        failedProviderId = error.providerId;

        if (!error.retryable || attempt === 1) {
          throw error;
        }
      }
    }

    throw new Error(`Model invocation failed after provider failover for agent: ${agentId}.`);
  }
}
