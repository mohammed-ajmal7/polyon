# POLYON Agent Instructions

## Project

POLYON (Personal AI Operations Network) is a personal AI workspace
for coordinating multiple AI agents, models, tools, research systems,
coding agents, and local intelligence.

## Core Principles

- Keep domain logic independent from UI frameworks.
- Keep model-provider logic behind provider adapters.
- Keep external integrations behind dedicated adapters.
- Shared contracts belong in packages/contracts.
- Never expose secrets to client-side code.
- Never bypass approval or policy controls for consequential actions.
- Prefer existing internal packages over duplicate implementations.
- Do not add dependencies without a clear reason.
- Preserve the ability to replace models, providers, runtimes, and integrations.

## Privacy

POLYON is personal and privacy-first.

Never commit:

- API keys
- access tokens
- OAuth secrets
- private keys
- credentials
- private user data

## Cost

POLYON is designed for zero additional operating cost.

Do not introduce paid services or paid APIs unless explicitly approved
by the project owner.

## External Integrations

The planned external integrations are:

- Google Drive
- Telegram
- Email

Do not introduce additional external integrations without explicit approval.

## Validation

Before considering a task complete:

1. Format changed files.
2. Run linting.
3. Run type checking.
4. Run relevant tests.
5. Inspect the Git diff.
6. Report failures honestly.

## Architecture

Do not place provider-specific logic in the core domain.

Do not place business logic directly inside UI components.

Do not allow clients to access provider secrets.

Prefer explicit interfaces and adapters over tightly coupled implementations.

## Project Context

Before continuing a substantial feature, read `docs/PROJECT-CONTEXT.md` for the current product goal, architecture, completed foundations, roadmap, and continuation procedure.

The repository code and tests remain the final source of truth when this context document and implementation differ.
