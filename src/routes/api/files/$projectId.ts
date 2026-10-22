import { createFileRoute } from "@tanstack/react-router";

import { PARAMS_FILE, ensureFileMetadata, errorResponse } from "@/server/backend-results";
import { number, readCsv, text } from "@/server/csv";
import type { MseedFile } from "@/services/types";

export const Route = createFileRoute("/api/files/$projectId")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        try {
          const { summaryPath, tableDir } = await ensureFileMetadata(params.projectId);
          const processed = await readProcessedFileNames(tableDir);
          const files = await readFilesFromSummary(params.projectId, summaryPath, processed);
          return Response.json({ files });
        } catch (error) {
          return errorResponse(error, "Falha ao carregar arquivos");
        }
      },
    },
  },
});

/** Files used by the latest completed run (from parametros_processamento.json). */
async function readProcessedFileNames(tableDir: string) {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  try {
    const content = await fs.readFile(path.join(tableDir, PARAMS_FILE), "utf8");
    const metadata = JSON.parse(content) as { input?: { files?: string[] } };
    return new Set(metadata.input?.files ?? []);
  } catch {
    return new Set<string>();
  }
}

async function readFilesFromSummary(
  projectId: string,
  summaryPath: string,
  processed: Set<string>,
): Promise<MseedFile[]> {
  const rows = await readCsv(summaryPath);

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
    status: processed.has(text(row.arquivo)) ? "processed" : "read",
  }));
}
