# POLYON AI Fleet Capabilities

POLYON keeps agent capabilities and model capabilities as separate routing concerns.

## Agent capabilities

Agent capability IDs describe what a role is responsible for. The built-in role catalog defines:

- planner
- researcher
- analyst
- specialist
- critic
- fact-checker
- judge
- synthesizer
- action-agent

Role definitions provide default capability IDs and can be overridden by an explicit agent capability list in model-fleet configuration.

## Model capabilities

Model capability IDs describe what a concrete model can actually support. The canonical built-in AI capabilities are:

- `ai.chat`
- `ai.reasoning`
- `ai.tool-calling`
- `ai.vision`
- `ai.audio`
- `ai.embeddings`
- `ai.structured-output`
- `ai.long-context`

Model metadata can also declare context window, tool support, vision support, privacy class, and cost class.

## Routing rule

The router first requires the agent to satisfy `requiredCapabilityIds`. Model-specific requirements are supplied separately through `requiredModelCapabilityIds`.

This prevents a specialist role from being incorrectly interpreted as proof that every model assigned to that role supports the same modality or execution capability.

The legacy `resolveAgentModel` and execution-routing APIs continue to map their existing capability requirements onto model requirements when an explicit model-capability list is not supplied.

## Fleet configuration

The server accepts the new metadata in `POLYON_MODEL_PROFILES_JSON` while preserving the existing configuration shape.

Example:

```json
[
  {
    "agentId": "planner",
    "agentRoleId": "planner",
    "modelId": "qwen3:8b",
    "providerId": "ollama",
    "contextWindow": 32768,
    "supportsTools": true,
    "privacyClass": "local",
    "costClass": "free"
  }
]
```

When `agentRoleId` is supplied, POLYON fills the role name, description, and default role capabilities from the built-in role catalog.

Model capability metadata is explicit and independent, so a shared model can serve several roles without changing the meaning of those roles.
