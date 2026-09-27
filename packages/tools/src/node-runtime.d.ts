declare module "node:fs" {
  export function closeSync(fileDescriptor: number): void;
  export function existsSync(path: string): boolean;
  export function fsyncSync(fileDescriptor: number): void;
  export function openSync(path: string, flags: string): number;
  export function readFileSync(path: string, encoding: "utf8"): string;
  export function renameSync(oldPath: string, newPath: string): void;
  export function unlinkSync(path: string): void;
  export function writeFileSync(path: string, data: string, encoding?: "utf8"): void;
  export function readSync(
    fileDescriptor: number,
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number | null,
  ): number;
  export function realpathSync(path: string): string;
  export function statSync(path: string): {
    readonly size: number;
    readonly mtimeMs: number;
    isDirectory(): boolean;
    isFile(): boolean;
  };
}

declare module "node:path" {
  export const sep: string;
  export function isAbsolute(path: string): boolean;
  export function relative(from: string, to: string): string;
  export function resolve(...paths: string[]): string;
}

declare module "node:child_process" {
  export interface SpawnedChildProcess {
    readonly stdout: {
      on(event: "data", listener: (chunk: Uint8Array) => void): void;
    };
    readonly stderr: {
      on(event: "data", listener: (chunk: Uint8Array) => void): void;
    };
    on(event: "error", listener: (error: unknown) => void): void;
    on(event: "close", listener: (exitCode: number | null, signal: string | null) => void): void;
    kill(): boolean;
  }

  export function spawn(
    command: string,
    args: readonly string[],
    options: {
      readonly cwd: string;
      readonly shell: false;
      readonly windowsHide?: boolean;
      readonly env?: Readonly<Record<string, string | undefined>>;
      readonly stdio: readonly ["ignore", "pipe", "pipe"];
    },
  ): SpawnedChildProcess;

  export function execFileSync(
    command: string,
    args: readonly string[],
    options?: {
      readonly encoding?: "utf8";
    },
  ): string;
}

declare const process: {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly execPath: string;
  readonly platform: string;
  cwd(): string;
};

declare module "node:crypto" {
  export function createHash(algorithm: "sha256"): {
    update(
      data: string,
      encoding?: "utf8",
    ): {
      digest(encoding: "hex"): string;
    };
  };
}
