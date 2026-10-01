# Contributing to POLYON

Thanks for helping improve POLYON.

## Development flow

Use the repository's integration flow:

```
feature/* -> develop -> release/* -> main
```

Create a focused feature branch, make the smallest coherent change that
completes the intended behavior, add or update tests, and open a pull request.

## Before opening a pull request

Run:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm lint
pnpm format:check
pnpm build
```

For container-facing changes also run:

```bash
docker build --file apps/web/Dockerfile --tag polyon:check .
cp apps/web/.env.example apps/web/.env
docker compose config --quiet
```

## Architecture

Preserve POLYON's boundaries:

- domain rules remain independent from the web framework;
- provider logic stays behind provider adapters;
- external systems stay behind integration adapters;
- consequential actions pass through policy and approval controls;
- secrets remain server-side;
- new dependencies need a clear reason.

## Pull requests

Explain the user-visible behavior, important architectural changes, tests
performed, and any operational or security implications. Avoid unrelated
refactors in feature pull requests.
