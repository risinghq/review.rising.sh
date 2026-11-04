export interface Chunk {
  id: string;
  source: string;
  page: number;
  status: string;
  text: string;
  alt: string | null;
  sharpness: number;
  agreement: number;
}

// Reads one `pXX-cYY.md` written by transcribe.py. The source comes from the
// store folder, not from the file: the file names the PDF (`02---continuous-random`),
// the site and the page bundle use `landi-02`.
export function parseChunk(source: string, name: string, file: string): Chunk {
  const end = file.indexOf("\n---\n", 4);
  if (!file.startsWith("---\n") || end < 0) throw new Error(`${source}/${name}: no front matter`);
  const fields = new Map<string, string>();
  const alt: string[] = [];
  let inAlt = false;
  for (const line of file.slice(4, end).split("\n")) {
    if (inAlt && line.startsWith("  ")) {
      alt.push(line.slice(2));
      continue;
    }
    inAlt = false;
    const colon = line.indexOf(":");
    const key = line.slice(0, colon);
    if (key === "alt") inAlt = true;
    else fields.set(key, line.slice(colon + 1).trim());
  }
  const need = (key: string) => {
    const value = fields.get(key);
    if (value === undefined) throw new Error(`${source}/${name}: missing ${key}`);
    return value;
  };
  return {
    id: `${source}/${name}`,
    source,
    page: Number(need("page")),
    status: need("status"),
    text: file.slice(end + "\n---\n".length).trimEnd(),
    alt: alt.length ? alt.join("\n") : null,
    sharpness: Number(need("sharpness")),
    agreement: Number(need("agreement")),
  };
}

// INSERT OR IGNORE keeps a chunk that is already loaded, with its status and
// reviews, when the loader runs again.
export function insertion(chunk: Chunk): { sql: string; params: (string | number | null)[] } {
  return {
    sql: "INSERT OR IGNORE INTO chunks (id, source, page, status, text, alt, sharpness, agreement) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
    params: [chunk.id, chunk.source, chunk.page, chunk.status, chunk.text, chunk.alt, chunk.sharpness, chunk.agreement],
  };
}
