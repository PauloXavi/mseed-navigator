import { createFileRoute } from "@tanstack/react-router";

import { ensureProjectResults } from "@/server/backend-results";
import type { MseedFile } from "@/services/types";

export const Route = createFileRoute("/api/files/$projectId")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        try {
          const results = await ensureProjectResults(params.projectId);
          const files = await readFilesFromSummary(params.projectId, results.tableDir);
          return Response.json({ files });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Falha ao carregar arquivos";
          return Response.json({ error: message }, { status: 500 });
        }
      },
    },
  },
});

async function readFilesFromSummary(projectId: string, tableDir: string): Promise<MseedFile[]> {
  const path = await import("node:path");
  const rows = await readCsv(path.join(tableDir, "resumo_por_arquivo.csv"));

  return rows.map((row, index) => ({
    id: `real-${index}-${text(row.arquivo)}`,
    projectId,
    uploadId: "backend-results",
    fileName: text(row.arquivo),
    extension: "mseed",
    sizeBytes: null,
    network: text(row.network),
    station: text(row.station),
    location: text(row.location),
    channel: text(row.channel),
    starttimeUtc: text(row.starttime_utc),
    endtimeUtc: text(row.endtime_utc),
    durationS: number(row.duration_s),
    samplingRateHz: number(row.sampling_rate_hz),
    npts: number(row.npts),
    min: number(row.min),
    max: number(row.max),
    mean: number(row.mean),
    std: number(row.std),
    p99Abs: number(row.p99_abs),
    peakAbs: number(row.peak_abs),
    status: "processed",
  }));
}

async function readCsv(filePath: string) {
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

function parseCsvLine(line: string) {
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

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

function number(value: unknown) {
  const parsed = typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}
