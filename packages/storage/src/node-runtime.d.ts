declare module "node:fs" {
  export function closeSync(fileDescriptor: number): void;
  export function existsSync(path: string): boolean;
  export function fsyncSync(fileDescriptor: number): void;
  export function mkdirSync(
    path: string,
    options?: {
      readonly recursive?: boolean;
    },
  ): void;
  export function mkdtempSync(path: string): string;
  export function openSync(path: string, flags: string): number;
  export function readFileSync(path: string, encoding: "utf8"): string;
  export function statSync(path: string): {
    readonly size: number;
    readonly mtimeMs: number;
    isDirectory(): boolean;
    isFile(): boolean;
  };
  export function renameSync(oldPath: string, newPath: string): void;
  export function rmSync(
    path: string,
    options?: {
      readonly recursive?: boolean;
      readonly force?: boolean;
    },
  ): void;
  export function unlinkSync(path: string): void;
  export function utimesSync(path: string, atime: Date, mtime: Date): void;
  export function writeFileSync(path: string, data: string, encoding?: "utf8"): void;
}

declare module "node:os" {
  export function tmpdir(): string;
}

declare module "node:path" {
  export function dirname(path: string): string;
  export function join(...paths: string[]): string;
}

declare module "node:crypto" {
  export function createHash(algorithm: "sha256"): {
    update(
      data: string,
      encoding?: "utf8",
    ): {
      digest(encoding: "hex"): string;
    };
  };
  export function randomUUID(): string;
}
