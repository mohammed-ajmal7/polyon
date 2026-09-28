import type { SemanticMemoryService } from "./semantic-memory-service";

export interface SemanticMemoryIndexerOptions {
  readonly intervalMs?: number;
  readonly batchSize?: number;
  readonly maxEntries?: number;
  readonly onError?: (error: unknown) => void;
}

export interface SemanticMemoryIndexerHealth {
  readonly running: boolean;
  readonly cycleActive: boolean;
  readonly indexedCount: number;
  readonly lastCycleAt?: string;
  readonly lastSuccessAt?: string;
  readonly lastErrorAt?: string;
  readonly lastError?: string;
  readonly consecutiveErrorCount: number;
}

export interface SemanticMemoryIndexer {
  start(): void;
  stop(): void;
  runOnce(): Promise<{
    readonly indexed: number;
    readonly stale: number;
    readonly skipped: number;
  }>;
  readonly health: SemanticMemoryIndexerHealth;
}

const DEFAULT_INTERVAL_MS = 30_000;
const DEFAULT_BATCH_SIZE = 16;
const DEFAULT_MAX_ENTRIES = 100;
const MIN_INTERVAL_MS = 1_000;
const MAX_INTERVAL_MS = 3_600_000;

export function createSemanticMemoryIndexer(
  service: SemanticMemoryService,
  modelId: string,
  options: SemanticMemoryIndexerOptions = {},
): SemanticMemoryIndexer {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;

  if (!Number.isInteger(intervalMs) || intervalMs < MIN_INTERVAL_MS || intervalMs > MAX_INTERVAL_MS) {
    throw new RangeError(
      `Semantic memory indexing interval must be an integer between ${MIN_INTERVAL_MS} and ${MAX_INTERVAL_MS} milliseconds.`,
    );
  }

  if (modelId.trim() === "") {
    throw new RangeError("Semantic memory indexing model ID must not be empty.");
  }

  let running = false;
  let cycleActive = false;
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  let indexedCount = 0;
  let lastCycleAt: string | undefined;
  let lastSuccessAt: string | undefined;
  let lastErrorAt: string | undefined;
  let lastError: string | undefined;
  let consecutiveErrorCount = 0;

  const schedule = (currentGeneration: number): void => {
    if (!running || generation !== currentGeneration) return;
    timer = globalThis.setTimeout(() => {
      void cycle(currentGeneration);
    }, intervalMs);
  };

  const executeCycle = async (signal?: AbortSignal): Promise<{ readonly indexed: number; readonly stale: number; readonly skipped: number }> => {
    cycleActive = true;
    lastCycleAt = new Date().toISOString();

    try {
      const result = await service.reindex(modelId, {
        now: new Date().toISOString(),
        batchSize,
        maxEntries,
        signal,
      });
      indexedCount += result.indexed;
      consecutiveErrorCount = 0;
      lastError = undefined;
      lastSuccessAt = new Date().toISOString();
      return result;
    } catch (error) {
      consecutiveErrorCount += 1;
      lastErrorAt = new Date().toISOString();
      lastError = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      cycleActive = false;
    }
  };

  const cycle = async (currentGeneration: number): Promise<void> => {
    if (!running || generation !== currentGeneration || cycleActive) return;

    controller = new AbortController();
    try {
      await executeCycle(controller.signal);
    } catch (error) {
      options.onError?.(error);
    } finally {
      controller = undefined;
      if (running && generation === currentGeneration) schedule(currentGeneration);
    }
  };

  return {
    start(): void {
      if (running) return;
      running = true;
      generation += 1;
      const currentGeneration = generation;
      void cycle(currentGeneration);
    },

    stop(): void {
      running = false;
      generation += 1;
      if (timer !== undefined) {
        globalThis.clearTimeout(timer);
        timer = undefined;
      }
      controller?.abort();
      controller = undefined;
    },

    runOnce(): Promise<{
      readonly indexed: number;
      readonly stale: number;
      readonly skipped: number;
    }> {
      if (cycleActive) {
        return Promise.reject(new Error("Semantic memory indexing cycle is already active."));
      }
      return executeCycle();
    },

    get health(): SemanticMemoryIndexerHealth {
      return {
        running,
        cycleActive,
        indexedCount,
        ...(lastCycleAt === undefined ? {} : { lastCycleAt }),
        ...(lastSuccessAt === undefined ? {} : { lastSuccessAt }),
        ...(lastErrorAt === undefined ? {} : { lastErrorAt }),
        ...(lastError === undefined ? {} : { lastError }),
        consecutiveErrorCount,
      };
    },
  };
}
