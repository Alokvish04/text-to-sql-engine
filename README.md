# Text-to-SQL Editor

Ask a question in plain English, get back a SQL query, tweak it if you want, run it, see the results. Built this to get some hands-on practice with LLM-powered tools instead of just reading about them.

**Live demo:** https://text-to-sql-engine.vercel.app

You can either poke around with the built-in sample dataset (a small company DB with employees, departments and projects) or upload your own CSV/SQLite file, or just paste a link to one.

## What it does

- Type a question, hit Generate, and it turns it into a SQL SELECT statement using Groq's API
- The SQL shows up in an editable box before you run it — I wanted it to feel like a real query tool, not a black box
- Works with your own data too: drag in a CSV, drop in a SQLite file, or paste a URL to one (I added basic protection against pointing the URL loader at internal/private addresses, since that's a common way these things get abused)
- Everything runs read-only. No INSERT/UPDATE/DELETE/DROP gets through, even if you edit the SQL yourself before running it
- The actual database queries happen in your browser (SQLite compiled to WebAssembly), not on a server, so your data never leaves your machine — only your question and the table/column names get sent to the AI

## Stack

- Next.js (App Router) + TypeScript
- Tailwind for styling
- sql.js for in-browser SQLite (went with this over a native SQLite binding so it doesn't need compiling and deploys cleanly to Vercel)
- Groq API for the NL → SQL step (free tier, no card needed)

## Running it locally

```bash
git clone https://github.com/Alokvish04/text-to-sql-engine.git
cd text-to-sql-engine
npm install
cp .env.example .env.local
```

Grab a free API key from [console.groq.com/keys](https://console.groq.com/keys) and drop it into `.env.local`:
