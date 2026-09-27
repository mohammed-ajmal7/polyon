import type { SecretReference } from "@polyon/contracts";
import { describe, expect, it, vi } from "vitest";

import { BoundedHttpClient } from "./bounded-http-client";
import {
  GoogleDriveIntegrationAdapter,
  GoogleDriveIntegrationAdapterError,
} from "./google-drive-integration-adapter";

const reference: SecretReference = {
  id: "google.primary",
  kind: "OAUTH_ACCESS_TOKEN",
  provider: "google",
};

function createAdapter(
  request: ReturnType<typeof vi.fn>,
): GoogleDriveIntegrationAdapter {
  return new GoogleDriveIntegrationAdapter({
    integrationId: "google-drive-primary",
    secretResolver: {
      resolve: vi.fn(async () => "google-token"),
    },
    secretReference: reference,
    client: {
      request,
    } as unknown as BoundedHttpClient,
    defaultPageSize: 20,
    maxPageSize: 100,
  });
}

describe("GoogleDriveIntegrationAdapter", () => {
  it("lists files using bounded page size and escaped query parameters", async () => {
    const request = vi.fn(async () => ({
      url: "https://www.googleapis.com/drive/v3/files",
      status: 200,
      statusText: "OK",
      headers: {
        "content-type": "application/json",
      },
      body: new TextEncoder().encode(
        JSON.stringify({
          files: [
            {
              id: "file-1",
              name: "Report.txt",
              mimeType: "text/plain",
              modifiedTime: "2026-09-27T00:00:00Z",
              capabilities: { canDownload: true },
            },
          ],
          nextPageToken: "next-1",
        }),
      ),
    }));

    const adapter = createAdapter(request);

    const result = await adapter.invoke({
      invocationId: "gdrive-list-1",
      operation: "LIST_FILES",
      input: {
        q: "name contains 'Report'",
        pageSize: 25,
        pageToken: "page-1",
      },
    });

    expect(result.output).toMatchObject({
      files: [
        {
          id: "file-1",
          name: "Report.txt",
          capabilities: { canDownload: true },
        },
      ],
      nextPageToken: "next-1",
    });

    const called = request.mock.calls[0];
    expect(called).toBeDefined();
    if (called === undefined) {
      throw new Error("Expected Google Drive list request.");
    }
    const input = called[0] as {
      readonly url: string;
      readonly headers?: Readonly<Record<string, string>>;
    };
    expect(input.url).toContain("pageSize=25");
    expect(input.url).toContain("fields=");
    expect(input.url).toContain("q=name+contains+%27%5C%27Report%5C%27%27");
    expect(input.headers).toEqual({
      Accept: "application/json",
      Authorization: "Bearer google-token",
    });
  });

  it("retrieves file metadata with a fixed field set and shared-drive support", async () => {
    const request = vi.fn(async () => ({
      url: "",
      status: 200,
      statusText: "OK",
      headers: {},
      body: new TextEncoder().encode(
        JSON.stringify({
          id: "file-2",
          name: "Archive.zip",
          mimeType: "application/zip",
          size: "1234",
          trashed: false,
        }),
      ),
    }));

    const adapter = createAdapter(request);

    const result = await adapter.invoke({
      invocationId: "gdrive-meta-1",
      operation: "GET_METADATA",
      input: {
        fileId: "file/2",
      },
    });

    expect(result.output).toEqual({
      file: {
        id: "file-2",
        name: "Archive.zip",
        mimeType: "application/zip",
        size: "1234",
        trashed: false,
      },
    });

    const called = request.mock.calls[0];
    expect(called).toBeDefined();
    if (called === undefined) {
      throw new Error("Expected Google Drive metadata request.");
    }
    const input = called[0] as {
      readonly url: string;
    };
    expect(input.url).toContain("/files/file%2F2?");
    expect(input.url).toContain("supportsAllDrives=true");
    expect(input.url).toContain("fields=");
  });

  it("rejects unsupported operations and invalid bounded inputs", async () => {
    const request = vi.fn();
    const adapter = createAdapter(request);

    await expect(
      adapter.invoke({
        invocationId: "gdrive-invalid-op",
        operation: "DELETE",
        input: {},
      }),
    ).rejects.toMatchObject({
      kind: "INVALID_INPUT",
    });

    await expect(
      adapter.invoke({
        invocationId: "gdrive-invalid-page",
        operation: "LIST_FILES",
        input: {
          pageSize: 101,
        },
      }),
    ).rejects.toMatchObject({
      kind: "INVALID_INPUT",
    });

    await expect(
      adapter.invoke({
        invocationId: "gdrive-invalid-query",
        operation: "LIST_FILES",
        input: {
          q: "x".repeat(2001),
        },
      }),
    ).rejects.toBeInstanceOf(GoogleDriveIntegrationAdapterError);
  });

  it("rejects non-success responses and malformed metadata", async () => {
    const request = vi.fn(async () => ({
      url: "",
      status: 403,
      statusText: "Forbidden",
      headers: {},
      body: new TextEncoder().encode(JSON.stringify({ error: "forbidden" })),
    }));

    const adapter = createAdapter(request);

    await expect(
      adapter.invoke({
        invocationId: "gdrive-error",
        operation: "GET_METADATA",
        input: {
          fileId: "file-1",
        },
      }),
    ).rejects.toMatchObject({
      kind: "API_ERROR",
    });

    request.mockResolvedValueOnce({
      url: "",
      status: 200,
      statusText: "OK",
      headers: {},
      body: new TextEncoder().encode(JSON.stringify({ name: "no-id" })),
    });

    await expect(
      adapter.invoke({
        invocationId: "gdrive-malformed",
        operation: "GET_METADATA",
        input: {
          fileId: "file-1",
        },
      }),
    ).rejects.toMatchObject({
      kind: "INVALID_RESPONSE",
    });
  });

  it("requires a Google OAuth access-token reference", () => {
    expect(
      () =>
        new GoogleDriveIntegrationAdapter({
          integrationId: "google-drive-primary",
          secretResolver: {
            resolve: vi.fn(async () => "token"),
          },
          secretReference: {
            id: "google.bad",
            kind: "API_KEY",
            provider: "google",
          },
          client: {
            request: vi.fn(),
          } as unknown as BoundedHttpClient,
        }),
    ).toThrow(RangeError);

    expect(
      () =>
        new GoogleDriveIntegrationAdapter({
          integrationId: "google-drive-primary",
          secretResolver: {
            resolve: vi.fn(async () => "token"),
          },
          secretReference: {
            id: "drive.bad",
            kind: "OAUTH_ACCESS_TOKEN",
            provider: "telegram",
          },
          client: {
            request: vi.fn(),
          } as unknown as BoundedHttpClient,
        }),
    ).toThrow(RangeError);
  });
});
