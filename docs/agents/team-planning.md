# POLYON agent team planning

Collective execution can operate with either an explicit target roster or a planner-generated team.

When the target list is omitted, the application asks the agent team planner for a bounded team. The planner:

- considers only ACTIVE agents;
- requires every selected agent to satisfy the requested model-routing constraints;
- supports capability, privacy, cost, context, tool, and provider-health requirements;
- supports explicit allowlists and exclusions;
- can prefer role matches;
- can prefer provider diversity;
- enforces a maximum of eight members;
- fails closed when the requested minimum team size cannot be formed.

The planner is deterministic. It does not decide what is true, and it does not bypass approval policy. It selects eligible participants so the application orchestration layer can run the appropriate workflow.

Explicit targets remain supported for reproducible runs and controlled operator workflows.

Agent definitions can also carry bounded execution metadata such as allowed tool IDs, maximum rounds, and maximum tokens. These are descriptive constraints; the existing policy/approval layer remains authoritative for consequential operations.
