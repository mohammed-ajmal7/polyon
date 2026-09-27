import { describe, expect, it, vi } from "vitest";

import type { Policy, SecretReference } from "@polyon/contracts";
import { BoundedHttpClient, TelegramIntegrationAdapter } from "@polyon/integrations";
import { InMemoryDomainStores } from "@polyon/storage";

import { IntegrationInvocationService } from "./integration-invocation-service";

const policy: Policy = {
  id: "telegram-policy",
  name: "Telegram policy",
  description: "Requires approval for Telegram communication.",
  approvalMode: "BALANCED",
  rules: [],
  defaultEffect: "REQUIRE_APPROVAL",
  enabled: true,
  createdAt: "2026-09-27T01:00:00.000Z",
  updatedAt: "2026-09-27T01:00:00.000Z",
};

const secretReference: SecretReference = {
  id: "telegram.primary",
  kind: "API_KEY",
  provider: "telegram",
};

describe("governed Telegram integration", () => {
  it("does not call Telegram until communication approval is resolved", async () => {
    const http = {
      request: vi.fn(async () => ({
        url: "https://api.telegram.org/botREDACTED/sendMessage",
        status: 200,
        statusText: "OK",
        headers: {},
        body: new TextEncoder().encode(
          JSON.stringify({
            ok: true,
            result: {
              message_id: 7,
              date: 2_000,
              chat: { id: 42 },
              text: "approved",
            },
          }),
        ),
      })),
    } as unknown as BoundedHttpClient;

    const telegram = new TelegramIntegrationAdapter({
      integrationId: "telegram-primary",
      secretReference,
      secretResolver: {
        resolve: vi.fn(async () => "123456:secret-token"),
      },
      client: http,
    });

    const stores = new InMemoryDomainStores();
    const integrations = {
      get: (id: string) => (id === telegram.integrationId ? telegram : undefined),
      list: () => [telegram],
      listByKind: () => [telegram],
      register() {
        throw new Error("unused");
      },
    };
    const service = new IntegrationInvocationService({
      integrations,
      approvals: stores.approvals,
      policyDecisions: stores.policyDecisions,
      events: stores.events,
      unitOfWork: stores,
    });

    const awaiting = await service.invoke({
      invocationId: "telegram-governed-1",
      integrationId: "telegram-primary",
      operation: "SEND_MESSAGE",
      input: {
        chatId: 42,
        text: "approved",
      },
      action: "EXTERNAL_COMMUNICATION",
      riskLevel: "HIGH",
      policy,
      decisionId: "telegram-decision-1",
      approvalRequestId: "telegram-approval-1",
      requestedBy: "agent-1",
      requestedAt: "2026-09-27T01:01:00.000Z",
      evaluatedAt: "2026-09-27T01:01:00.000Z",
      actorId: "agent-1",
      executionId: "execution-telegram-1",
      agentId: "agent-1",
    });

    expect(awaiting.status).toBe("APPROVAL_REQUIRED");
    expect(http.request).not.toHaveBeenCalled();

    service.resolveApproval({
      approvalId: "telegram-approval-1",
      status: "APPROVED",
      resolvedAt: "2026-09-27T01:02:00.000Z",
      resolvedBy: "user-1",
    });

    const result = await service.invokeApproved({
      invocationId: "telegram-governed-1",
      approvalId: "telegram-approval-1",
      integrationId: "telegram-primary",
      operation: "SEND_MESSAGE",
      input: {
        chatId: 42,
        text: "approved",
      },
    });

    expect(result.status).toBe("SUCCEEDED");
    expect(http.request).toHaveBeenCalledOnce();
  });
});
