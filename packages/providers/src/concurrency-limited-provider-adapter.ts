import type {
  ModelProviderAdapter,
  ProviderInvocationRequest,
  ProviderInvocationResult,
} from "./provider-adapter";

/**
 * Bounds how many requests POLYON sends to one provider at a time and queues the rest
 * in-process. Local runtimes such as Ollama serve only a few requests concurrently; flooding
 * them makes queued requests exceed HTTP client timeouts before generation even starts.
 */
export class ConcurrencyLimitedProviderAdapter<
  TInput = unknown,
  TOutput = unknown,
> implements ModelProviderAdapter<TInput, TOutput> {
  readonly providerId: ModelProviderAdapter<TInput, TOutput>["providerId"];

  private active = 0;
  private readonly waiters: (() => void)[] = [];

  constructor(
    private readonly inner: ModelProviderAdapter<TInput, TOutput>,
    private readonly maxConcurrency: number,
  ) {
    if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1) {
      throw new RangeError("Provider maxConcurrency must be a positive integer.");
    }
    this.providerId = inner.providerId;
  }

  async invoke(
    request: ProviderInvocationRequest<TInput>,
  ): Promise<ProviderInvocationResult<TOutput>> {
    await this.acquire(request.signal);
    try {
      return await this.inner.invoke(request);
    } finally {
      this.release();
    }
  }

  private acquire(signal: AbortSignal | undefined): Promise<void> {
    if (signal?.aborted === true) return Promise.reject(abortError());
    if (this.active < this.maxConcurrency) {
      this.active += 1;
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      const grant = () => {
        signal?.removeEventListener("abort", onAbort);
        this.active += 1;
        resolve();
      };
      const onAbort = () => {
        const index = this.waiters.indexOf(grant);
        if (index !== -1) this.waiters.splice(index, 1);
        reject(abortError());
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.waiters.push(grant);
    });
  }

  private release(): void {
    this.active -= 1;
    this.waiters.shift()?.();
  }
}

function abortError(): Error {
  const error = new Error("Provider invocation was cancelled while queued.");
  error.name = "AbortError";
  return error;
}
