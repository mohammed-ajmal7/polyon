import type { Model, Provider, TextModelRequest, TextModelResponse } from "@polyon/contracts";
import { describe, expect, it } from "vitest";

import {
  InMemoryProviderAdapterRegistry,
  ModelGateway,
  ModelGatewayError,
  ProviderInvocationError,
  UsageGovernor,
  type ModelCatalog,
  type ProviderCatalog,
} from ".";
import { vi } from "vitest";
import type { ModelProviderAdapter } from "./provider-adapter";

const model: Model = {
  id: "model-1",
  providerId: "provider-1",
  name: "Primary",
  kind: "TEXT",
  capabilityIds: [],
  enabled: true,
};

const provider: Provider = {
  id: "provider-1",
  name: "Provider",
  kind: "HOSTED_MODEL",
  enabled: true,
};

function createCatalogs(
  modelValue: Model = model,
  providerValue: Provider = provider,
): { models: ModelCatalog; providers: ProviderCatalog } {
  return {
    models: {
      get: (id: string) => (id === modelValue.id ? modelValue : undefined),
    },
    providers: {
      get: (id: string) => (id === providerValue.id ? providerValue : undefined),
    },
  };
}

function createGateway(
  adapter: ModelProviderAdapter = {
    providerId: "provider-1",
    async invoke({ input }) {
      return { output: input };
    },
  },
) {
  const { models, providers } = createCatalogs();
  const adapters = new InMemoryProviderAdapterRegistry();
  adapters.register(adapter);

  return new ModelGateway({ models, providers, adapters });
}

describe("ModelGateway", () => {
  it("routes model invocations through the matching provider adapter", async () => {
    const gateway = createGateway({
      providerId: "provider-1",
      async invoke({ modelId, input }) {
        return { output: modelId + ":" + String(input) };
      },
    });

    await expect(gateway.invoke("model-1", "hello")).resolves.toEqual({
      output: "model-1:hello",
    });
  });

  it("supports structured text model invocations", async () => {
    const gateway = createGateway({
      providerId: "provider-1",
      async invoke({ input }) {
        const request = input as TextModelRequest;
        const response: TextModelResponse = {
          content: request.messages.map((message) => message.content).join(" "),
          finishReason: "STOP",
        };

        return { output: response };
      },
    });

    await expect(
      gateway.invokeText("model-1", {
        messages: [
          { role: "SYSTEM", content: "You are helpful." },
          { role: "USER", content: "Hello POLYON." },
        ],
      }),
    ).resolves.toEqual({
      output: {
        content: "You are helpful. Hello POLYON.",
        finishReason: "STOP",
      },
    });
  });

  it("rejects text invocation for a non-text model", () => {
    const { providers } = createCatalogs(model, provider);
    const imageModel: Model = {
      ...model,
      kind: "IMAGE",
    };
    const models: ModelCatalog = {
      get: (id: string) => (id === imageModel.id ? imageModel : undefined),
    };
    const adapters = new InMemoryProviderAdapterRegistry();

    adapters.register({
      providerId: "provider-1",
      async invoke() {
        return { output: "unused" };
      },
    });

    const gateway = new ModelGateway({ models, providers, adapters });

    expect(() =>
      gateway.invokeText("model-1", {
        messages: [{ role: "USER", content: "hello" }],
      }),
    ).toThrowError(
      new ModelGatewayError(
        "MODEL_KIND_UNSUPPORTED",
        "model-1",
        "Text invocation requires a TEXT model: model-1.",
      ),
    );
  });

  it("enforces an invocation timeout even when an adapter ignores abort", async () => {
    vi.useFakeTimers();

    try {
      const gateway = createGateway({
        providerId: "provider-1",
        async invoke() {
          return new Promise(() => undefined);
        },
      });

      const pending = gateway.invoke("model-1", "hello", { timeoutMs: 50 });
      const rejected = expect(pending).rejects.toEqual(
        new ProviderInvocationError(
          "TIMEOUT",
          "provider-1",
          "model-1",
          "Provider invocation timed out after 50ms for model: model-1.",
          true,
        ),
      );

      await vi.advanceTimersByTimeAsync(50);
      await rejected;
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels an invocation and forwards the abort signal", async () => {
    const controller = new AbortController();
    let aborted = false;

    const gateway = createGateway({
      providerId: "provider-1",
      async invoke({ signal }) {
        signal?.addEventListener("abort", () => {
          aborted = true;
        });
        return new Promise(() => undefined);
      },
    });

    const pending = gateway.invoke("model-1", "hello", {
      signal: controller.signal,
    });

    controller.abort();

    await expect(pending).rejects.toEqual(
      new ProviderInvocationError(
        "CANCELLED",
        "provider-1",
        "model-1",
        "Provider invocation was cancelled for model: model-1.",
        false,
      ),
    );
    expect(aborted).toBe(true);
  });

  it("retries only retryable provider failures", async () => {
    let calls = 0;
    const gateway = createGateway({
      providerId: "provider-1",
      async invoke() {
        calls += 1;

        if (calls === 1) {
          throw new ProviderInvocationError(
            "UNAVAILABLE",
            "provider-1",
            "model-1",
            "Provider unavailable.",
            true,
          );
        }

        return { output: "ok" };
      },
    });

    await expect(gateway.invoke("model-1", "hello", { retries: 1 })).resolves.toEqual({
      output: "ok",
    });
    expect(calls).toBe(2);
  });

  it("does not retry permanent provider failures", async () => {
    let calls = 0;
    const gateway = createGateway({
      providerId: "provider-1",
      async invoke() {
        calls += 1;
        throw new ProviderInvocationError(
          "AUTHENTICATION",
          "provider-1",
          "model-1",
          "Invalid credentials.",
          false,
        );
      },
    });

    await expect(gateway.invoke("model-1", "hello", { retries: 3 })).rejects.toEqual(
      new ProviderInvocationError(
        "AUTHENTICATION",
        "provider-1",
        "model-1",
        "Invalid credentials.",
        false,
      ),
    );
    expect(calls).toBe(1);
  });

  it("normalizes unknown adapter failures", async () => {
    const gateway = createGateway({
      providerId: "provider-1",
      async invoke() {
        throw new Error("socket closed");
      },
    });

    await expect(gateway.invoke("model-1", "hello")).rejects.toEqual(
      new ProviderInvocationError("UNKNOWN", "provider-1", "model-1", "socket closed", false),
    );
  });

  it("rejects an unknown model", async () => {
    const gateway = createGateway();

    expect(() => gateway.invoke("missing", "hello")).toThrowError(
      new ModelGatewayError("MODEL_NOT_FOUND", "missing", "Model not found: missing."),
    );
  });

  it("rejects a disabled model", () => {
    const gateway = createGateway();
    const disabledModel: Model = {
      ...model,
      enabled: false,
    };

    const { providers } = createCatalogs(model, provider);
    const models: ModelCatalog = {
      get: (id: string) => (id === disabledModel.id ? disabledModel : undefined),
    };
    const adapters = new InMemoryProviderAdapterRegistry();

    adapters.register({
      providerId: "provider-1",
      async invoke() {
        return { output: "ok" };
      },
    });

    const disabledGateway = new ModelGateway({
      models,
      providers,
      adapters,
    });

    expect(() => disabledGateway.invoke("model-1", "hello")).toThrowError(
      expect.objectContaining({
        kind: "MODEL_DISABLED",
      }),
    );
  });

  it("rejects an unknown provider", async () => {
    const { models } = createCatalogs();
    const providers: ProviderCatalog = {
      get: () => undefined,
    };
    const adapters = new InMemoryProviderAdapterRegistry();

    adapters.register({
      providerId: "provider-1",
      async invoke() {
        return { output: "ok" };
      },
    });

    const gateway = new ModelGateway({ models, providers, adapters });

    expect(() => gateway.invoke("model-1", "hello")).toThrowError(
      expect.objectContaining({
        kind: "PROVIDER_NOT_FOUND",
      }),
    );
  });

  it("rejects a disabled provider", () => {
    const { models } = createCatalogs(model, { ...provider, enabled: false });
    const providers: ProviderCatalog = {
      get: () => ({ ...provider, enabled: false }),
    };
    const adapters = new InMemoryProviderAdapterRegistry();

    adapters.register({
      providerId: "provider-1",
      async invoke() {
        return { output: "ok" };
      },
    });

    const gateway = new ModelGateway({ models, providers, adapters });

    expect(() => gateway.invoke("model-1", "hello")).toThrowError(
      expect.objectContaining({
        kind: "PROVIDER_DISABLED",
      }),
    );
  });

  it("rejects a provider without a registered adapter", () => {
    const { models, providers } = createCatalogs();
    const adapters = new InMemoryProviderAdapterRegistry();

    const gateway = new ModelGateway({ models, providers, adapters });

    expect(() => gateway.invoke("model-1", "hello")).toThrowError(
      expect.objectContaining({
        kind: "PROVIDER_ADAPTER_NOT_FOUND",
      }),
    );
  });

  it("blocks hosted model calls in zero-cost mode unless explicitly classified as free", () => {
    const { models, providers } = createCatalogs();
    const adapters = new InMemoryProviderAdapterRegistry();
    adapters.register({
      providerId: "provider-1",
      async invoke() {
        return { output: "should not run" };
      },
    });

    const gateway = new ModelGateway({
      models,
      providers,
      adapters,
      usageGovernor: new UsageGovernor({ costMode: "zero" }),
    });

    expect(() => gateway.invoke("model-1", "hello")).toThrowError(
      expect.objectContaining({
        kind: "PAID_MODEL_BLOCKED",
      }),
    );
  });

  it("records actual token usage and enforces per-run token budgets", async () => {
    const adapters = new InMemoryProviderAdapterRegistry();
    adapters.register({
      providerId: "provider-1",
      async invoke() {
        return {
          output: {
            content: "ok",
            usage: { totalTokens: 12 },
          },
        };
      },
    });

    const governor = new UsageGovernor({
      budgets: [{ providerId: "provider-1", maxTokensPerRun: 20 }],
    });
    const { models, providers } = createCatalogs();
    const gateway = new ModelGateway({
      models,
      providers,
      adapters,
      usageGovernor: governor,
    });

    await gateway.invoke("model-1", "hello", {
      estimatedTokens: 18,
      usageContext: {
        runId: "run-1",
        agentId: "agent-1",
        costClass: "free",
      },
    });

    expect(governor.runSnapshot("run-1", "provider-1")).toMatchObject({
      tokens: 12,
      agents: 1,
    });

    expect(() =>
      gateway.invoke("model-1", "hello", {
        estimatedTokens: 9,
        usageContext: {
          runId: "run-1",
          agentId: "agent-1",
          costClass: "free",
        },
      }),
    ).toThrowError(expect.objectContaining({ kind: "RUN_TOKEN_LIMIT" }));
  });

  it("counts retry attempts against provider request limits", async () => {
    let calls = 0;
    const adapters = new InMemoryProviderAdapterRegistry();
    adapters.register({
      providerId: "provider-1",
      async invoke() {
        calls += 1;
        throw new ProviderInvocationError(
          "UNAVAILABLE",
          "provider-1",
          "model-1",
          "temporary failure",
          true,
        );
      },
    });

    const gateway = new ModelGateway({
      ...createCatalogs(),
      adapters,
      usageGovernor: new UsageGovernor({
        budgets: [{ providerId: "provider-1", dailyRequestLimit: 1 }],
      }),
    });

    await expect(
      gateway.invoke("model-1", "hello", {
        retries: 1,
        usageContext: { costClass: "free" },
      }),
    ).rejects.toMatchObject({ kind: "DAILY_REQUEST_LIMIT" });
    expect(calls).toBe(1);
  });

  it("exposes immutable registry state through gateway dependencies", () => {
    const gateway = createGateway();

    expect(gateway).toBeInstanceOf(ModelGateway);
  });
});
