// The few Node APIs the CLI and the tests use. Declared here instead of
// depending on @types/node, so TypeScript stays the only dev dependency and
// the core (which must also run in the browser) compiles without any Node types.

declare module "node:test" {
  export function test(name: string, fn: () => void): void;
}

declare module "node:assert/strict" {
  const assert: {
    equal(actual: unknown, expected: unknown, message?: string): void;
    deepEqual(actual: unknown, expected: unknown, message?: string): void;
    ok(value: unknown, message?: string): void;
    match(value: string, pattern: RegExp, message?: string): void;
  };
  export default assert;
}

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
