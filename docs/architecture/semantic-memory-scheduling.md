# POLYON durable semantic-memory scheduling

Automatic semantic-memory indexing runs through the existing durable `JobService` and `JobRuntime`; it does not create a second scheduler or worker queue.

## Lifecycle

When the semantic indexer starts with a configured job bridge, it creates one deterministic queued `scheduled` job for the configured actor/model if no active semantic-index job exists. Repeated starts are idempotent.

The scheduled job payload contains only scheduler/model/configuration metadata and the explicit privacy-scope allowlist. Provider credentials remain behind the existing provider/secret boundaries.

`JobRuntime` owns execution, bounded concurrency, retry behavior, cancellation, and running-job recovery. The semantic indexer only supplies the domain-specific job handler.

After a successful indexing cycle, the handler schedules the next cycle at the configured interval. When the final retry attempt fails, the next future cycle is still scheduled so a transient embedding-provider failure cannot permanently stop automatic indexing.

## Stop and restart behavior

Stopping the indexer aborts its local work and cancels queued semantic-index jobs. A running durable job is not silently duplicated. On process restart, the existing durable job state and `JobRuntime` recovery rules remain authoritative.

Manual `runOnce()` remains available for explicit maintenance and does not depend on the background scheduler.

## Privacy boundary

Automatic indexing is created only when semantic indexing is explicitly enabled with a non-empty memory-scope allowlist. The durable job identity is bound to the configured local actor, while payloads contain no secrets.
