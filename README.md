# Text-to-SQL Editor

Upload your own data (CSV files or a SQLite database), ask a question in plain English, get back an editable SQL query, run it, and see the results, all in one page.

Built with Next.js (App Router), Groq's LLM API for the natural-language → SQL step, and SQLite running **in the browser** via `sql.js` (SQLite compiled to WebAssembly). A small sample company database is loaded until you upload something.

## How it works

1. You upload one or more `.csv` files, or a single `.sqlite` / `.sqlite3` / `.db` file. It's loaded into an in-browser SQLite database. CSV columns get types (INTEGER / REAL / TEXT) inferred automatically.
2. The app reads the table and column names (plus primary and foreign keys) from that database.
3. You ask a question. `POST /api/generate-sql` sends **only the question and that schema description** to Groq, which returns a single SQL `SELECT`.
4. The SQL appears in an editable box. Tweak it if you like, then run it. The query executes in your browser against your data.

## Loading data from a URL

Besides uploading files, you can paste a direct link to a `.csv` or `.sqlite` file (for example a raw GitHub URL). This goes through `POST /api/generate-sql`'s sibling route, `/api/fetch-remote`, which:

- only allows `http://` / `https://` URLs
- resolves the hostname and refuses to fetch private, loopback, link-local or reserved IP ranges (this also blocks cloud metadata endpoints like `169.254.169.254`) — each hop of a redirect is re-checked the same way, up to 5 hops
- times out after 15 seconds and caps downloads at 50 MB
- detects CSV vs SQLite from the URL's extension, or by sniffing the SQLite file header if there's no extension

The fetched bytes are sent back to the browser and loaded exactly like an uploaded file, so the same read-only and privacy behavior applies. Note this is a best-effort guard, not a hardened security boundary — if you deploy this publicly, consider adding rate limiting too, since it also uses your Groq quota (see the note under Deploying to Vercel).

## Privacy

- Uploaded files never leave the browser and are not stored anywhere. Refreshing the page clears them.
- The AI only ever sees your question and the table/column names, never the rows.

## Read-only by design

Only `SELECT` queries (including `WITH ... SELECT`) can run. This is enforced twice: a validator that ignores string literals and comments, and SQLite's own `PRAGMA query_only`.

## Limits

- CSV files up to 25 MB each, SQLite files up to 50 MB.
- Several CSVs can be uploaded together (each becomes a table you can join). A SQLite file must be uploaded on its own.
- Result tables show the first 500 rows.
- SQLite only. Other engines (Postgres, MySQL) would need a server-side connection.

## Setup

```bash
npm install
cp .env.example .env.local     # Windows: copy .env.example .env.local
# put your Groq key in .env.local  (free at https://console.groq.com/keys)
npm run dev
```

Open http://localhost:3000. The SQLite engine is loaded from the jsDelivr CDN at runtime, so the browser needs internet access.

## Deploying to Vercel

1. Push this project to GitHub and import it into Vercel.
2. Add `GROQ_API_KEY` under Settings → Environment Variables.
3. Deploy. There is no database or server state to configure.

Note that anyone with your deployed URL can trigger requests against your Groq quota. Before sharing it widely, consider adding rate limiting or a sign-in step to `/api/generate-sql`.

## Models

The default model is `openai/gpt-oss-120b`. If Groq retires it, set `GROQ_MODEL` in `.env.local` (see Groq's model list) without changing any code.

## Project structure

```
app/
  page.tsx                    the editor UI + upload/URL handling
  api/generate-sql/route.ts   question + schema -> SQL (Groq)
  api/fetch-remote/route.ts   fetches a CSV/SQLite URL server-side (SSRF-guarded)
lib/
  sqljs.ts                    loads sql.js (SQLite/WASM) in the browser
  database.ts                 open .sqlite, import CSV, read schema, run queries
  csv.ts                      CSV parsing and column type inference
  sqlGuard.ts                 read-only SQL validation
  schema.ts                   sample company dataset
  groq.ts                     Groq client + prompt
test-data/                    bookstore.sqlite and students.csv to try
```
