declare module "node:fs" {
  export function closeSync(fileDescriptor: number): void;
  export function existsSync(path: string): boolean;
  export function openSync(path: string, flags: string): number;
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
