# POLYON agent roles and AI capabilities

POLYON keeps two related but distinct contracts:

- **Agent capabilities** describe what an agent is allowed and intended to do.
- **Model capabilities** describe what the selected model can technically provide.

A route must satisfy the agent capability contract. Model-specific requirements are additional hard constraints.

## Built-in agent roles

The core role catalog contains:

- Planner
- Researcher
- Analyst
- Specialist
- Critic
- Fact Checker
- Judge
- Synthesizer
- Action Agent

Roles are descriptive metadata. Runtime safety still comes from routing, policy, permissions, approvals, and bounded orchestration.

## Canonical AI model capabilities

The model capability catalog currently covers:

- `ai.chat`
- `ai.reasoning`
- `ai.tool-calling`
- `ai.vision`
- `ai.audio`
- `ai.embeddings`
- `ai.structured-output`
- `ai.long-context`

These IDs are provider-independent so the routing layer does not depend on vendor names.

## Fleet configuration

`POLYON_MODEL_PROFILES_JSON` may declare:

- `agentRoleId` for a built-in role;
- `agentCapabilityIds` for explicit agent skills;
- `modelCapabilityIds` for model features;
- `contextWindow`;
- `supportsTools`;
- `supportsVision`;
- `privacyClass`;
- `costClass`;
- fallback model IDs.

Example:

```json
[
  {
    "agentId": "researcher",
    "agentRoleId": "researcher",
    "modelId": "qwen3:8b",
    "providerId": "ollama",
    "modelCapabilityIds": ["ai.chat", "ai.reasoning", "ai.tool-calling"],
    "contextWindow": 32768,
    "supportsTools": true,
    "privacyClass": "local",
    "costClass": "free"
  }
]
```

Legacy profiles remain supported. When `agentRoleId` is supplied, POLYON can populate the role's default agent capabilities.

The runtime team planner remains bounded to at most eight active members even though the configuration parser can hold a larger roster. This allows a full role catalog to exist without creating unbounded collective execution.

## Routing boundary

Model routing treats privacy, cost, context, tool support, provider health, and model capabilities as hard constraints where requested. Provider endpoints and secrets remain outside these contracts.
