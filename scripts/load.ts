// Loads finished chunks of one source into D1 and R2.
//   bun scripts/load.ts STORE_DIR/landi-02 [--dry-run]
// STORE_DIR/landi-02/chunks holds the pXX-cYY.md and .png files from transcribe.py.
// The folder name is the source. Running it again changes nothing already loaded.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

import { insertion, parseChunk } from "./chunk.ts";

const DATABASE = "39b2ebec-b6bb-492b-8f97-08583bcaf564";
const BUCKET = "review-scans";
const PROFILE = "risinghq";
const BATCH = 100;

function cf(args: string[]) {
  const run = spawnSync("bunx", ["cf", ...args, "--profile", PROFILE], { encoding: "utf8" });
  if (run.status !== 0) throw new Error(`cf ${args.slice(0, 3).join(" ")}: ${run.stderr || run.stdout}`);
  return run.stdout;
}

const dry = process.argv.includes("--dry-run");
const dir = resolve(process.argv.slice(2).find((a: string) => !a.startsWith("--")) ?? "");
const source = basename(dir);
const chunks = join(dir, "chunks");
const names = readdirSync(chunks).filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3)).sort();
if (names.length === 0) throw new Error(`no chunks in ${chunks}`);

const rows = names.map((name) => insertion(parseChunk(source, name, readFileSync(join(chunks, `${name}.md`), "utf8"))));
const scratch = mkdtempSync(join(tmpdir(), "load-"));
for (let i = 0; i < rows.length; i += BATCH) {
  const file = join(scratch, `batch-${i}.json`);
  writeFileSync(file, JSON.stringify(rows.slice(i, i + BATCH)));
  if (!dry) cf(["d1", "query", DATABASE, "--batch", `@${file}`]);
}
for (const name of names) {
  const png = join(chunks, `${name}.png`);
  if (!dry) cf(["r2", "objects", "put", `${source}/${name}.png`, "--bucket-name", BUCKET, "--file", png, "--content-type", "image/png"]);
}
console.log(`${dry ? "would load" : "loaded"} ${rows.length} chunks of ${source}`);
