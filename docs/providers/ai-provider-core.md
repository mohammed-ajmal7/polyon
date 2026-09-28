# POLYON AI provider core

This repository uses one provider-neutral text-model transport and configures provider-specific behavior through explicit presets.

## Built-in providers

The current built-in presets are:

| Provider | POLYON provider kind | Default endpoint | Default key reference | Privacy class |
| --- | --- | --- | --- | --- |
| Ollama | `LOCAL_MODEL` | `http://127.0.0.1:11434/v1/chat/completions` | `OLLAMA_API_KEY` (optional) | local |
| Google Gemini | `HOSTED_MODEL` | Gemini OpenAI-compatibility chat endpoint | `GEMINI_API_KEY` | cloud |
| OpenAI | `HOSTED_MODEL` | OpenAI Chat Completions endpoint | `OPENAI_API_KEY` | cloud |

Gemini uses Google's OpenAI-compatible API surface so POLYON does not need a provider-specific transport implementation for the common text/tool contract. Provider-specific features can be added behind separate adapters later without changing the orchestration layer.

## Configuration behavior

A model profile may omit `endpoint` when its `providerId` is one of the built-in providers. POLYON resolves the provider's default endpoint internally.

Custom providers remain supported, but they must provide an explicit endpoint.

API keys are referenced by environment-variable name. The actual secret value is resolved only in the server-side model-registration path and is not part of the model profile JSON.

Example local configuration:

```env
POLYON_MODEL_PROFILES_JSON=[{"agentId":"researcher","modelId":"qwen3:8b","providerId":"ollama"}]
```

Example hosted configuration:

```env
POLYON_MODEL_PROFILES_JSON=[{"agentId":"analyst","modelId":"gemini-3.8-flash","providerId":"gemini","apiKeyEnv":"GEMINI_API_KEY"}]
GEMINI_API_KEY=
```

Keep execution disabled until the local/provider configuration has been validated.

## Boundary

Provider presets are configuration and adapter-selection concerns. They do not contain POLYON orchestration logic, policy decisions, permissions, approvals, or UI behavior.

The provider transport remains replaceable because the application depends on the `ModelProviderAdapter` contract rather than a vendor SDK.

## Next provider-core work

The next provider milestone is to add provider/model health and capability metadata to the routing path, followed by the central cost/usage governor. These should remain provider-independent and configurable; provider quotas and pricing must not be hard-coded into application logic.
