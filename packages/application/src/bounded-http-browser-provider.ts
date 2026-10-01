import { BoundedHttpClient } from "@polyon/integrations";

import type { BrowserProvider, BrowseResult } from "./research-fabric";

export interface BoundedHttpBrowserProviderOptions {
  readonly maxResponseBytes?: number;
}

export class BoundedHttpBrowserProvider implements BrowserProvider {
  readonly kind = "browser" as const;
  readonly id: string;
  private readonly maxResponseBytes: number;

  constructor(
    private readonly http: BoundedHttpClient,
    options: BoundedHttpBrowserProviderOptions = {},
  ) {
    this.id = "bounded-http-browser";
    this.maxResponseBytes = options.maxResponseBytes ?? 100_000;

    if (!Number.isInteger(this.maxResponseBytes) || this.maxResponseBytes <= 0) {
      throw new RangeError("maxResponseBytes must be a positive integer.");
    }
  }

  async fetch(
    locator: string,
    options: { readonly signal?: AbortSignal; readonly maxCharacters?: number } = {},
  ): Promise<BrowseResult> {
    const normalizedLocator = locator.trim();
    if (normalizedLocator === "") {
      throw new RangeError("Browser locator must not be empty.");
    }
    if (
      options.maxCharacters !== undefined &&
      (!Number.isInteger(options.maxCharacters) || options.maxCharacters <= 0)
    ) {
      throw new RangeError("Browser maxCharacters must be a positive integer.");
    }

    const response = await this.http.request(
      {
        url: normalizedLocator,
        method: "GET",
        signal: options.signal,
      },
      { maxResponseBytes: this.maxResponseBytes },
    );

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Browser source returned HTTP ${response.status}.`);
    }

    const contentType = response.headers["content-type"];
    const content = new TextDecoder().decode(response.body);
    const boundedContent =
      options.maxCharacters === undefined
        ? content
        : Array.from(content).slice(0, options.maxCharacters).join("");

    return {
      locator: normalizedLocator,
      content: boundedContent,
      ...(contentType === undefined ? {} : { contentType }),
      retrievedAt: new Date().toISOString(),
    };
  }
}
