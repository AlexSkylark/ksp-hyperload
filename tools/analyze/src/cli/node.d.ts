// The few Node APIs the CLI uses. Declared here instead of depending on
// @types/node, so TypeScript stays the only dev dependency and the core
// (which must also run in the browser) compiles without any Node types.

declare module "node:fs" {
  export function readFileSync(path: string, encoding: "utf8"): string;
  export function readdirSync(path: string): string[];
  export function existsSync(path: string): boolean;
}

declare module "node:path" {
  export function join(...paths: string[]): string;
  export function basename(path: string): string;
}

declare var process: {
  argv: string[];
  exit(code?: number): never;
};

declare var console: {
  log(...data: unknown[]): void;
  error(...data: unknown[]): void;
};
