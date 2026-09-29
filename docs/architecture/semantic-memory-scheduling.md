# POLYON durable semantic memory scheduling

Automatic semantic-memory indexing is scheduled through the existing durable JobService and JobRuntime.

## Lifecycle

On indexer startup, the scheduler creates exactly one deterministic queued `scheduled` job for the configured owner/model when no active semantic-index job exists. Repeated starts are idempotent.

JobRuntime executes the job and already provides bounded concurrency, retry backoff, cancellation, and running-job recovery. The index handler reindexes only the configured privacy scopes.

After a successful cycle, the handler persists the next cycle with the configured interval. After the final retry attempt fails, the scheduler still creates the next future cycle so a transient provider outage cannot permanently disable automatic indexing.

Manual `runOnce()` remains available for explicit maintenance and does not depend on the background scheduler.

## Safety and isolation

Scheduler job IDs include the configured owner identity. Job payloads contain only non-secret scheduler/model/configuration metadata; provider credentials remain behind the existing secret/provider boundaries.

Stopping the scheduler cancels queued semantic-index jobs. A running job is allowed to finish or be cancelled by the JobRuntime it belongs to; a stopped scheduler does not create a replacement cycle.

This design intentionally does not add a second scheduler or worker queue.
