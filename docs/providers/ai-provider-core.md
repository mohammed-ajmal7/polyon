# POLYON AI provider core

This repository uses one provider-neutral text-model transport and explicit provider presets.

## Built-in providers

POLYON currently defines these built-in provider configurations:

- Ollama: local model provider with a loopback OpenAI-compatible chat endpoint.
- Google Gemini: hosted provider using Google's OpenAI-compatible chat endpoint.
- OpenAI: hosted provider using the OpenAI Chat Completions endpoint.
- Groq: hosted provider using Groq's OpenAI-compatible Chat API endpoint.
- OpenRouter: hosted provider using OpenRouter's OpenAI-compatible API endpoint.

Built-in profiles may omit an endpoint because POLYON can resolve the configured provider default. Custom providers must provide an explicit endpoint.

API keys are referenced by environment-variable name. The actual secret value is resolved only in the server-side registration path and is never stored in the model profile JSON.

## Configuration

Example local profile:

```env
POLYON_MODEL_PROFILES_JSON=[{"agentId":"researcher","modelId":"qwen3:8b","providerId":"ollama"}]
```

Example hosted profile:

```env
POLYON_MODEL_PROFILES_JSON=[{"agentId":"analyst","modelId":"gemini-3.8-flash","providerId":"gemini","apiKeyEnv":"GEMINI_API_KEY"}]
GEMINI_API_KEY=
```

Keep execution disabled until the provider configuration has been validated.

## Boundary

Provider presets handle configuration and adapter selection only. They do not contain orchestration, policy, approval, or UI logic.

The transport remains replaceable because the application depends on the `ModelProviderAdapter` contract rather than a vendor SDK.
