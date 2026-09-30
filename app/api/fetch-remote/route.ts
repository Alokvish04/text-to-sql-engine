import { NextRequest, NextResponse } from "next/server";
import dns from "node:dns/promises";

export const runtime = "nodejs";

const MAX_BYTES = 50 * 1024 * 1024; // matches MAX_SQLITE_BYTES in lib/database.ts
const FETCH_TIMEOUT_MS = 15000;
const MAX_REDIRECTS = 5;
const SQLITE_MAGIC = "SQLite format 3\u0000";
const SQLITE_EXT = /\.(sqlite|sqlite3|db|db3)$/i;
const CSV_EXT = /\.(csv|tsv)$/i;

/* ---------- SSRF guard: block requests to internal/reserved addresses ---------- */

function ipv4ToLong(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = (n << 8) | v;
  }
  return n >>> 0;
}

function inV4Range(ipLong: number, base: string, bits: number): boolean {
  const baseLong = ipv4ToLong(base);
  if (baseLong === null) return false;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipLong & mask) === (baseLong & mask);
}

// RFC 1918 / 5735 style reserved ranges, plus cloud metadata (169.254.169.254
// falls under link-local) and the usual loopback/broadcast blocks.
const V4_RESERVED: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
  ["255.255.255.255", 32],
];

function isPrivateIPv4(ip: string): boolean {
  const long = ipv4ToLong(ip);
  if (long === null) return true; // unparseable: fail closed
  return V4_RESERVED.some(([base, bits]) => inV4Range(long, base, bits));
}

function isPrivateIPv6(ip: string): boolean {
  const low = ip.toLowerCase();
  if (low === "::1" || low === "::") return true;
  if (low.startsWith("fe80:") || low.startsWith("fc") || low.startsWith("fd")) return true; // link-local + unique local
  if (low.startsWith("::ffff:")) {
    const v4 = low.split(":").pop() ?? "";
    if (v4.includes(".")) return isPrivateIPv4(v4);
  }
  return false;
}

async function assertPublicHost(hostname: string): Promise<void> {
  const bare = hostname.replace(/^\[|\]$/g, "");

  if (bare === "localhost") {
    throw new Error("Requests to localhost aren't allowed.");
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(bare)) {
    if (isPrivateIPv4(bare)) throw new Error("That address isn't reachable.");
    return;
  }
  if (bare.includes(":")) {
    if (isPrivateIPv6(bare)) throw new Error("That address isn't reachable.");
    return;
  }

  let records;
  try {
    records = await dns.lookup(bare, { all: true });
  } catch {
    throw new Error("Couldn't resolve that host.");
  }
  if (records.length === 0) throw new Error("Couldn't resolve that host.");
  for (const r of records) {
    if (r.family === 4 && isPrivateIPv4(r.address)) {
      throw new Error("That host resolves to a private address, which isn't allowed.");
    }
    if (r.family === 6 && isPrivateIPv6(r.address)) {
      throw new Error("That host resolves to a private address, which isn't allowed.");
    }
  }
}

/* ---------- helpers ---------- */

function detectNameAndKind(
  urlPath: string,
  head: Uint8Array
): { filename: string; kind: "csv" | "sqlite" } {
  const seg = decodeURIComponent(urlPath.split("/").filter(Boolean).pop() ?? "");
  if (SQLITE_EXT.test(seg)) return { filename: seg, kind: "sqlite" };
  if (CSV_EXT.test(seg)) return { filename: seg, kind: "csv" };

  const header = new TextDecoder("latin1").decode(head.slice(0, 16));
  if (header === SQLITE_MAGIC) {
    return { filename: seg ? `${seg}.sqlite` : "download.sqlite", kind: "sqlite" };
  }
  return { filename: seg ? `${seg}.csv` : "download.csv", kind: "csv" };
}

/* ---------- route ---------- */

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json();
    if (!url || typeof url !== "string" || !url.trim()) {
      return NextResponse.json({ error: "Enter a URL." }, { status: 400 });
    }

    let current = url.trim();
    let bytes: Uint8Array | null = null;
    let finalPath = "";

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      let parsed: URL;
      try {
        parsed = new URL(current);
      } catch {
        return NextResponse.json({ error: `Not a valid URL: ${current}` }, { status: 400 });
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return NextResponse.json(
          { error: "Only http:// and https:// URLs are supported." },
          { status: 400 }
        );
      }

      try {
        await assertPublicHost(parsed.hostname);
      } catch (err) {
        return NextResponse.json(
          { error: err instanceof Error ? err.message : "That host isn't reachable." },
          { status: 400 }
        );
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      let res: Response;
      try {
        res = await fetch(parsed.toString(), {
          redirect: "manual",
          signal: controller.signal,
          headers: { "User-Agent": "text-to-sql-engine" },
        });
      } catch {
        return NextResponse.json(
          { error: "Couldn't reach that URL (timed out or connection failed)." },
          { status: 400 }
        );
      } finally {
        clearTimeout(timer);
      }

      if ([301, 302, 303, 307, 308].includes(res.status)) {
        const loc = res.headers.get("location");
        if (!loc) {
          return NextResponse.json(
            { error: "That URL redirected without a destination." },
            { status: 400 }
          );
        }
        current = new URL(loc, parsed).toString();
        continue;
      }

      if (!res.ok) {
        return NextResponse.json(
          { error: `The server responded with ${res.status} ${res.statusText}.` },
          { status: 400 }
        );
      }

      const lenHeader = res.headers.get("content-length");
      if (lenHeader && Number(lenHeader) > MAX_BYTES) {
        return NextResponse.json(
          { error: `That file is larger than ${MAX_BYTES / 1024 / 1024} MB.` },
          { status: 400 }
        );
      }

      const reader = res.body?.getReader();
      if (!reader) {
        return NextResponse.json(
          { error: "Couldn't read a response body from that URL." },
          { status: 400 }
        );
      }

      const chunks: Uint8Array[] = [];
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_BYTES) {
          await reader.cancel().catch(() => {});
          return NextResponse.json(
            { error: `That file is larger than ${MAX_BYTES / 1024 / 1024} MB.` },
            { status: 400 }
          );
        }
        chunks.push(value);
      }

      bytes = new Uint8Array(total);
      let offset = 0;
      for (const c of chunks) {
        bytes.set(c, offset);
        offset += c.byteLength;
      }
      finalPath = parsed.pathname;
      break;
    }

    if (!bytes) {
      return NextResponse.json({ error: "Too many redirects." }, { status: 400 });
    }
    if (bytes.byteLength === 0) {
      return NextResponse.json({ error: "That URL returned an empty file." }, { status: 400 });
    }

    const { filename, kind } = detectNameAndKind(finalPath, bytes);
    return NextResponse.json({
      filename,
      kind,
      contentBase64: Buffer.from(bytes).toString("base64"),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Couldn't load that URL." },
      { status: 500 }
    );
  }
}
