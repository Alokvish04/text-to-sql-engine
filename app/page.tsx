"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  loadSqlJs,
  type SqlDatabase,
  type SqlJsStatic,
  type SqlValue,
} from "@/lib/sqljs";
import {
  createSampleDb,
  extractSchema,
  importCsv,
  lockReadOnly,
  MAX_CSV_BYTES,
  MAX_SQLITE_BYTES,
  openSqliteFile,
  runSelect,
  type SchemaInfo,
} from "@/lib/database";

const SQLITE_EXT = /\.(sqlite|sqlite3|db|db3)$/i;
const CSV_EXT = /\.(csv|tsv)$/i;
const SAMPLE_NAME = "Sample company data";

function formatCell(value: SqlValue) {
  if (value === null) return <span className="text-muted">null</span>;
  if (value instanceof Uint8Array) return <span className="text-muted">&lt;blob&gt;</span>;
  return String(value);
}

export default function Home() {
  const sqlRef = useRef<SqlJsStatic | null>(null);
  const dbRef = useRef<SqlDatabase | null>(null);

  const [engine, setEngine] = useState<"loading" | "ready" | "error">("loading");
  const [engineError, setEngineError] = useState<string | null>(null);

  const [schema, setSchema] = useState<SchemaInfo | null>(null);
  const [sourceName, setSourceName] = useState(SAMPLE_NAME);
  const [isSample, setIsSample] = useState(true);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);
  const [dragging, setDragging] = useState(false);

  const [urlInput, setUrlInput] = useState("");
  const [urlLoading, setUrlLoading] = useState(false);

  const [question, setQuestion] = useState("");
  const [sql, setSql] = useState("");
  const [columns, setColumns] = useState<string[]>([]);
  const [rows, setRows] = useState<SqlValue[][]>([]);
  const [truncated, setTruncated] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasRun, setHasRun] = useState(false);

  // Swap in a new database and reset everything that belonged to the old one.
  const installDb = useCallback(
    (db: SqlDatabase, name: string, sample: boolean) => {
      lockReadOnly(db);
      const info = extractSchema(db); // may throw: caller cleans up `db`
      dbRef.current?.close();
      dbRef.current = db;
      setSchema(info);
      setSourceName(name);
      setIsSample(sample);
      setQuestion("");
      setSql("");
      setColumns([]);
      setRows([]);
      setTruncated(false);
      setHasRun(false);
      setError(null);
    },
    []
  );

  useEffect(() => {
    let cancelled = false;
    loadSqlJs()
      .then((SQL) => {
        if (cancelled) return;
        sqlRef.current = SQL;
        installDb(createSampleDb(SQL), SAMPLE_NAME, true);
        setEngine("ready");
      })
      .catch((err) => {
        if (cancelled) return;
        setEngine("error");
        setEngineError(
          err instanceof Error ? err.message : "Could not start the SQLite engine."
        );
      });
    return () => {
      cancelled = true;
    };
  }, [installDb]);

  function loadSample() {
    const SQL = sqlRef.current;
    if (!SQL) return;
    setUploadError(null);
    installDb(createSampleDb(SQL), SAMPLE_NAME, true);
  }

  async function handleFiles(fileList: FileList | File[] | null) {
    const SQL = sqlRef.current;
    if (!SQL || !fileList) return;
    const files = Array.from(fileList);
    if (files.length === 0) return;

    setUploadError(null);
    setLoadingFile(true);
    let db = null as SqlDatabase | null;

    try {
      const sqliteFiles = files.filter((f) => SQLITE_EXT.test(f.name));
      const csvFiles = files.filter((f) => CSV_EXT.test(f.name));
      const unsupported = files.filter(
        (f) => !SQLITE_EXT.test(f.name) && !CSV_EXT.test(f.name)
      );

      if (unsupported.length > 0) {
        throw new Error(
          `${unsupported[0].name} isn't supported. Upload .csv, .sqlite, .sqlite3 or .db files.`
        );
      }
      if (sqliteFiles.length > 0 && files.length > 1) {
        throw new Error(
          "Upload one SQLite database, or one or more CSV files, but not a mix."
        );
      }

      await new Promise((resolve) => setTimeout(resolve, 0)); // let "Loading…" paint

      if (sqliteFiles.length === 1) {
        const file = sqliteFiles[0];
        if (file.size > MAX_SQLITE_BYTES) {
          throw new Error(
            `${file.name} is larger than ${MAX_SQLITE_BYTES / 1024 / 1024} MB.`
          );
        }
        db = openSqliteFile(SQL, new Uint8Array(await file.arrayBuffer()));
        installDb(db, file.name, false);
      } else {
        db = new SQL.Database();
        for (const file of csvFiles) {
          if (file.size > MAX_CSV_BYTES) {
            throw new Error(
              `${file.name} is larger than ${MAX_CSV_BYTES / 1024 / 1024} MB.`
            );
          }
          importCsv(db, file.name, await file.text());
        }
        installDb(
          db,
          csvFiles.length === 1 ? csvFiles[0].name : `${csvFiles.length} CSV files`,
          false
        );
      }
      db = null; // installDb now owns it
    } catch (err) {
      db?.close();
      setUploadError(err instanceof Error ? err.message : "Couldn't load that file.");
    } finally {
      setLoadingFile(false);
    }
  }

  async function handleLoadUrls() {
    const urls = Array.from(
      new Set(
        urlInput
          .split(/[\s,]+/)
          .map((s) => s.trim())
          .filter(Boolean)
      )
    );
    if (urls.length === 0 || urlLoading || loadingFile) return;

    setUploadError(null);
    setUrlLoading(true);
    try {
      const files: File[] = [];
      for (const u of urls) {
        const res = await fetch("/api/fetch-remote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: u }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(`${u}\n${data.error || "Couldn't load that URL."}`);
        }
        const bytes = Uint8Array.from(atob(data.contentBase64), (c) => c.charCodeAt(0));
        files.push(
          new File([bytes], data.filename, {
            type: data.kind === "sqlite" ? "application/octet-stream" : "text/csv",
          })
        );
      }
      await handleFiles(files);
      setUrlInput("");
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Couldn't load from that URL.");
    } finally {
      setUrlLoading(false);
    }
  }

  async function handleGenerate() {
    if (!question.trim() || generating || !schema) return;
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/generate-sql", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, schema: schema.promptText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not generate SQL.");
      setSql(data.sql);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setGenerating(false);
    }
  }

  async function handleRun() {
    const db = dbRef.current;
    if (!db || !sql.trim() || running) return;
    setRunning(true);
    setError(null);
    await new Promise((resolve) => setTimeout(resolve, 0)); // let "Running…" paint
    try {
      const result = runSelect(db, sql);
      setColumns(result.columns);
      setRows(result.rows);
      setTruncated(result.truncated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Query failed.");
      setColumns([]);
      setRows([]);
      setTruncated(false);
    } finally {
      setRunning(false);
      setHasRun(true);
    }
  }

  const ready = engine === "ready";

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <header className="flex items-center gap-2 px-5 py-4 border-b border-white/10 shrink-0">
        <span className="font-mono text-sm">/\</span>
        <span className="font-semibold text-sm">Text→SQL</span>
      </header>

      <main className="flex flex-1 overflow-hidden">
        <aside className="w-72 shrink-0 border-r border-white/10 p-5 overflow-y-auto">
          <p className="text-sm text-muted mb-2">Data source</p>
          <p className="font-mono text-sm text-white break-all">{sourceName}</p>
          {schema && (
            <p className="text-xs text-muted mt-0.5">
              {schema.tables.length} {schema.tables.length === 1 ? "table" : "tables"}
            </p>
          )}

          <label
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              if (ready && !loadingFile) handleFiles(e.dataTransfer.files);
            }}
            className={`mt-4 block rounded-lg border border-dashed px-3 py-4 text-center text-sm cursor-pointer transition-colors focus-within:border-white/60 ${
              dragging ? "border-white/60 bg-white/5" : "border-white/20 hover:border-white/40"
            } ${!ready || loadingFile || urlLoading ? "opacity-50 pointer-events-none" : ""}`}
          >
            <input
              type="file"
              multiple
              accept=".csv,.tsv,.sqlite,.sqlite3,.db,.db3"
              className="sr-only"
              disabled={!ready || loadingFile || urlLoading}
              onChange={(e) => {
                handleFiles(e.target.files);
                e.target.value = ""; // allow re-selecting the same file
              }}
            />
            {loadingFile ? "Loading…" : "Upload or drop your data"}
            <span className="block text-xs text-muted mt-1">
              .csv (one or several) or a .sqlite / .db file
            </span>
          </label>

          <div className="mt-4">
            <label htmlFor="urlInput" className="block text-xs text-muted mb-1.5">
              …or load from a URL
            </label>
            <div className="flex gap-2">
              <input
                id="urlInput"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleLoadUrls();
                }}
                placeholder="https://example.com/data.csv"
                disabled={!ready || urlLoading || loadingFile}
                className="flex-1 min-w-0 bg-panel border border-white/15 rounded-lg px-2.5 py-2 text-xs text-ivory placeholder:text-muted/70 disabled:opacity-50"
              />
              <button
                onClick={handleLoadUrls}
                disabled={!ready || urlLoading || loadingFile || !urlInput.trim()}
                className="px-3 py-2 border border-white/15 hover:border-white/40 hover:bg-white/5 text-xs rounded-lg whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {urlLoading ? "Loading…" : "Load"}
              </button>
            </div>
            <p className="text-[11px] text-muted mt-1">
              One .sqlite URL, or one or more .csv URLs (space or comma separated).
            </p>
          </div>

          {uploadError && (
            <p className="mt-3 text-xs text-red whitespace-pre-wrap">{uploadError}</p>
          )}

          {!isSample && ready && (
            <button
              onClick={loadSample}
              className="mt-3 text-xs text-muted hover:text-white underline underline-offset-2"
            >
              Use the sample data instead
            </button>
          )}

          <p className="mt-4 text-xs text-muted leading-relaxed">
            Your files stay in your browser. Only your question and the table and
            column names are sent to the AI.
          </p>

          <p className="text-sm text-muted mt-6 mb-4">Schema</p>
          {engine === "loading" && <p className="text-xs text-muted">Loading SQLite engine…</p>}
          {engine === "error" && <p className="text-xs text-red">{engineError}</p>}
          {schema && schema.tables.length === 0 && (
            <p className="text-xs text-muted">This database has no tables.</p>
          )}
          {schema?.tables.map((table) => (
            <div key={table.name} className="mb-5">
              <p className="font-mono text-sm text-white mb-1.5 break-all">
                {table.name}
                {table.kind === "view" && <span className="text-muted"> · view</span>}
                {table.rowCount !== null && (
                  <span className="text-muted text-xs"> · {table.rowCount.toLocaleString()} rows</span>
                )}
              </p>
              <ul>
                {table.columns.map((col) => (
                  <li key={col.name} className="font-mono text-xs text-muted pl-3 py-0.5 break-all">
                    {col.name}
                    <span className="opacity-60"> {col.type}</span>
                    {col.references && <span className="opacity-60"> → {col.references}</span>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </aside>

        <section className="flex-1 flex flex-col min-w-0">
          <div className="border-b border-white/10 p-5">
            <label htmlFor="question" className="block text-sm text-muted mb-2">
              Ask a question about your data
            </label>
            <div className="flex gap-3">
              <input
                id="question"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleGenerate();
                }}
                placeholder={
                  isSample
                    ? "e.g. Which department has the highest total employee salary?"
                    : "e.g. How many rows are in each table?"
                }
                className="flex-1 bg-panel border border-white/15 rounded-lg px-3 py-2.5 text-sm text-ivory placeholder:text-muted/70"
              />
              <button
                onClick={handleGenerate}
                disabled={!ready || generating || !question.trim()}
                className="px-4 py-2.5 bg-white text-black text-sm font-medium rounded-lg whitespace-nowrap hover:bg-ivory transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {generating ? "Generating…" : "Generate SQL"}
              </button>
            </div>
          </div>

          <div className="border-b border-white/10 p-5 flex flex-col" style={{ height: "38%" }}>
            <div className="flex items-center justify-between mb-2">
              <label htmlFor="sql" className="text-sm text-muted">
                SQL — edit it before running if you want
              </label>
              <button
                onClick={handleRun}
                disabled={!ready || running || !sql.trim()}
                className="px-3 py-1.5 border border-white/15 hover:border-white/40 hover:bg-white/5 text-sm rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {running ? "Running…" : "Run query"}
              </button>
            </div>
            <textarea
              id="sql"
              value={sql}
              onChange={(e) => setSql(e.target.value)}
              spellCheck={false}
              placeholder="-- generated SQL will appear here, or write your own SELECT"
              className="flex-1 bg-panel border border-white/15 rounded-lg p-3 font-mono text-sm text-ivory placeholder:text-muted/70 resize-none"
            />
          </div>

          <div className="flex-1 overflow-auto p-5">
            {error && (
              <p className="font-mono text-sm text-red whitespace-pre-wrap">{error}</p>
            )}

            {!error && hasRun && rows.length === 0 && (
              <p className="text-sm text-muted">Query ran — no rows returned.</p>
            )}

            {!error && rows.length > 0 && (
              <div className="overflow-auto">
                <table className="w-full text-sm font-mono border-collapse">
                  <thead>
                    <tr>
                      {columns.map((col, c) => (
                        <th
                          key={c}
                          className="text-left border-b border-white/15 py-1.5 pr-6 text-muted font-normal whitespace-nowrap"
                        >
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, r) => (
                      <tr key={r} className="border-b border-white/5">
                        {row.map((value, c) => (
                          <td key={c} className="py-1.5 pr-6 whitespace-nowrap">
                            {formatCell(value)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {truncated && (
                  <p className="text-xs text-muted mt-3">
                    Showing the first {rows.length} rows. Add a LIMIT or a filter to narrow it down.
                  </p>
                )}
              </div>
            )}

            {!error && !hasRun && (
              <p className="text-sm text-muted">
                Results will show up here once you run a query.
              </p>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
