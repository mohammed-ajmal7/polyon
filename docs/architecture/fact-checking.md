# POLYON Fact Checking

## Purpose

Fact checking is a bounded application capability for validating explicit claims against supplied POLYON evidence.

```text
Claims
  ↓
Referenced Evidence
  ↓
Evidence Quality
  ↓
Fact Checker Agent
  ↓
SUPPORTED / CONTRADICTED / UNRESOLVED
  ↓
Traceable Result
```

## Boundary

The Fact Checker receives explicit claims and explicit evidence IDs. It does not retrieve new evidence, treat agent agreement as proof, or execute external actions.

Evidence and source records remain authoritative. The Fact Checker only interprets the supplied evidence and returns a bounded verdict, optional confidence, rationale, and the evidence IDs used.

## Validation

- Claim IDs and text are required and bounded.
- Referenced evidence must exist.
- A model response can only reference evidence attached to the corresponding claim.
- Verdicts are limited to `SUPPORTED`, `CONTRADICTED`, and `UNRESOLVED`.
- Invalid or incomplete model output falls back to `UNRESOLVED` rather than inventing a verdict.
- Evidence quality uses the existing deterministic evidence-quality service.

## Traceability

Each invocation emits `FACT_CHECK_STARTED`, one `FACT_CHECK_RESULT` per claim, and `FACT_CHECK_COMPLETED` events. Events contain claim IDs, verdicts, rationale, and referenced evidence IDs without introducing provider-specific state.

## Integration boundary

`FactCheckService` is exposed through the main POLYON composition and remains provider-independent through `AgentGateway`. Automatic invocation from research/deep-analysis orchestration is intentionally a separate integration slice so the fact-check stage can be enabled and governed explicitly.
