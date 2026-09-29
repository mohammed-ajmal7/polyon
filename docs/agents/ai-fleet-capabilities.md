# POLYON AI Fleet Capabilities

POLYON keeps agent capabilities and model capabilities as separate routing concerns.

## Agent capabilities

Agent capability IDs describe what a role is responsible for. The built-in role catalog defines the nine core roles:

- `planner`
- `researcher`
- `analyst`
- `specialist`
- `critic`
- `fact-checker`
- `judge`
- `synthesizer`
- `action-agent`

Role definitions provide default capability IDs and can be overridden by an explicit agent capability list.

## Model capabilities

Model capability IDs describe what a concrete model can actually support:

- `ai.chat`
- `ai.reasoning`
- `ai.tool-calling`
- `ai.vision`
- `ai.audio`
- `ai.embeddings`
- `ai.structured-output`
- `ai.long-context`

Model metadata also supports context window, tools, vision, privacy, and cost classification.

## Routing rule

`requiredCapabilityIds` constrains the agent. `requiredModelCapabilityIds` constrains the selected model.

This separation prevents an agent's job description from being treated as proof that every model assigned to it supports the same modality or execution feature.

The legacy `resolveAgentModel` and execution-routing APIs preserve their previous behavior by mapping their existing capability requirement onto model requirements when an explicit model-capability list is absent.

## Fleet configuration

`POLYON_MODEL_PROFILES_JSON` can declare role and model metadata without requiring a new configuration format.

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

When `agentRoleId` is present, the server fills the built-in role name, description, and default agent capabilities. Model capabilities remain independent and explicit.
