# POLYON Implementation Status

## Current boundaries

The implementation currently separates the core domain from application orchestration and infrastructure adapters.

```text
contracts
   ↑
core
   ↑
application

agents → providers
tools → core
runtime → core + storage
integrations → core
storage → contracts
```

The execution path is represented explicitly:

```text
Task
 ↓
Execution creation
 ↓
Policy evaluation
 ↓
Approval when required
 ↓
Queue
 ↓
Runtime coordinator
 ↓
Runner
 ↓
Execution result
```

Logical agents are separate from models and providers. Agent routing resolves a compatible model and provider before invocation.

External capabilities remain adapter-bound. Planned first-class integrations are Google Drive, Telegram, and Email.

## Verification status

The repository has a CI workflow for typechecking, tests, linting, and formatting. Local verification remains the authoritative final check when running the repository on the development machine.
