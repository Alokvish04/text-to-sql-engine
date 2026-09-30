// Loads sql.js (SQLite compiled to WebAssembly) in the browser.
// The script is pulled from a CDN at runtime, which keeps it out of the
// Next.js bundle (sql.js has Node-only branches that bundlers dislike).

const VERSION = "1.11.0";
const BASE = `https://cdn.jsdelivr.net/npm/sql.js@${VERSION}/dist/`;

export type SqlValue = string | number | Uint8Array | null;

export interface SqlStatement {
  step(): boolean;
  get(): SqlValue[];
  getColumnNames(): string[];
  run(values?: SqlValue[]): void;
  free(): boolean;
}

export interface SqlDatabase {
  run(sql: string, params?: SqlValue[]): SqlDatabase;
  exec(sql: string): { columns: string[]; values: SqlValue[][] }[];
  prepare(sql: string): SqlStatement;
  close(): void;
}

export interface SqlJsStatic {
  Database: new (data?: ArrayLike<number>) => SqlDatabase;
}

declare global {
  interface Window {
    initSqlJs?: (config: {
      locateFile: (file: string) => string;
    }) => Promise<SqlJsStatic>;
  }
}

let enginePromise: Promise<SqlJsStatic> | null = null;

export function loadSqlJs(): Promise<SqlJsStatic> {
  if (enginePromise) return enginePromise;

  enginePromise = new Promise<SqlJsStatic>((resolve, reject) => {
    const fail = (message: string) => {
      enginePromise = null; // allow a retry on the next call
      reject(new Error(message));
    };

    const script = document.createElement("script");
    script.src = BASE + "sql-wasm.js";
    script.async = true;

    script.onload = () => {
      if (!window.initSqlJs) {
        script.remove();
        return fail("The SQLite engine loaded but did not initialise.");
      }
      window
        .initSqlJs({ locateFile: (file) => BASE + file })
        .then(resolve, (err) =>
          fail(err instanceof Error ? err.message : "SQLite engine failed to start.")
        );
    };

    script.onerror = () => {
      script.remove();
      fail(
        "Could not load the SQLite engine. Check your internet connection and reload the page."
      );
    };

    document.head.appendChild(script);
  });

  return enginePromise;
}
