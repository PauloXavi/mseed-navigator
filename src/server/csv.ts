// Minimal CSV reader for the tables written by pandas (comma separated, optional quotes).

export async function readCsv(filePath: string): Promise<Record<string, string>[]> {
  const fs = await import("node:fs/promises");
  const content = await fs.readFile(filePath, "utf8");
  const lines = content.trim().split(/\r?\n/);
  if (lines.length <= 1) return [];

  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

export function parseCsvLine(line: string) {
  const values: string[] = [];
  let current = "";
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"' && quoted && next === '"') {
      current += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  values.push(current);
  return values;
}

export function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

/** Parses a numeric cell; empty/NaN cells become 0. */
export function number(value: unknown) {
  return nullableNumber(value) ?? 0;
}

/** Parses a numeric cell; empty/NaN cells become null (e.g. undefined SNR). */
export function nullableNumber(value: unknown) {
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function bool(value: unknown) {
  return typeof value === "string" && value.toLowerCase() === "true";
}
