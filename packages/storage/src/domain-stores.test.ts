import type {
  ApprovalRequest,
  Conversation,
  Execution,
  Message,
  Mission,
  PolicyDecision,
} from "@polyon/contracts";
import { describe, expect, it } from "vitest";

import { InMemoryDomainStores } from "./domain-stores";

const mission: Mission = {
  id: "mission-1",
  objective: "Build POLYON",
  constraints: [],
  status: "RUNNING",
  taskIds: [],
  createdAt: "2026-09-27T01:00:00.000Z",
  updatedAt: "2026-09-27T01:00:00.000Z",
};

const conversation: Conversation = {
  id: "conversation-1",
  kind: "MISSION",
  status: "ACTIVE",
  participantIds: ["user-1", "agent-1"],
  messageIds: [],
  missionId: "mission-1",
  createdAt: "2026-09-27T01:00:00.000Z",
  updatedAt: "2026-09-27T01:00:00.000Z",
};

const message: Message = {
  id: "message-1",
  conversationId: "conversation-1",
  actorId: "user-1",
  role: "USER",
  kind: "TEXT",
  content: "Build POLYON.",
  createdAt: "2026-09-27T01:01:00.000Z",
};

const execution: Execution = {
  id: "execution-1",
  missionId: "mission-1",
  taskId: "task-1",
  actorId: "agent-1",
  attempt: 1,
  status: "PENDING",
  createdAt: "2026-09-27T01:00:00.000Z",
  updatedAt: "2026-09-27T01:00:00.000Z",
};

describe("InMemoryDomainStores", () => {
  it("provides independent stores for each domain entity", () => {
    const stores = new InMemoryDomainStores();

    stores.missions.save(mission);
    stores.conversations.save(conversation);
    stores.messages.save(message);
    stores.executions.save(execution);

    expect(stores.missions.get("mission-1")).toEqual(mission);
    expect(stores.conversations.get("conversation-1")).toEqual(conversation);
    expect(stores.messages.get("message-1")).toEqual(message);
    expect(stores.executions.get("execution-1")).toEqual(execution);
    expect(stores.tasks.get("mission-1")).toBeUndefined();
    expect(stores.artifacts.get("execution-1")).toBeUndefined();
    expect(stores.approvals.get("approval-1")).toBeUndefined();
    expect(stores.policyDecisions.get("decision-1")).toBeUndefined();
  });
});
