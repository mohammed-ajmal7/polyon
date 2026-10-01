# POLYON structured findings

A `Finding` is the normalized unit an agent can use to communicate a claim without collapsing the reasoning trace into one opaque paragraph.

Each finding contains:

- `agentId` — the producer;
- `claim` — the explicit proposition;
- `evidence` — evidence references tied to durable source/evidence records;
- `confidence` — an explicit producer-reported value between 0 and 1;
- `assumptions` — conditions the claim depends on;
- `counterarguments` — known competing explanations;
- `disposition` — `SUPPORTED`, `CONTRADICTED`, `UNRESOLVED`, or `INFERRED`.

Confidence is not used as proof. Evidence quality and contradictions remain separate signals.

## Research integration

Research agents are asked to provide the structured envelope when possible. POLYON parses and validates it against the evidence actually retrieved for that research task.

When a model returns ordinary prose or malformed JSON, the research run remains valid and retains the prose finding. The structured field is simply absent.

This compatibility behavior allows heterogeneous providers and models to participate without forcing every model to support a native structured-output API.

## Deterministic validation

The core `createFinding` constructor enforces non-empty identity/claim fields and a confidence range of 0..1. It does not manufacture confidence when the producer omitted it.

Structured findings are currently attached to research findings. Collective/debate stages can reuse the same contract in later orchestration slices.
