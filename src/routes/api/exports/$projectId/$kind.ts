import { createFileRoute } from "@tanstack/react-router";

import {
  FIGURE_FILES,
  TABLE_FILES,
  ensureProjectResults,
  errorResponse,
  runProcess,
} from "@/server/backend-results";

type ExportKind = "csv" | "figures" | "bundle";

export const Route = createFileRoute("/api/exports/$projectId/$kind")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const kind = params.kind as ExportKind;
        if (!["csv", "figures", "bundle"].includes(kind)) {
          return Response.json({ error: "Tipo de exportação inválido" }, { status: 400 });
        }

        try {
          const zip = await buildExportZip(params.projectId, kind);
          return new Response(zip.buffer, {
            headers: {
              "content-type": "application/zip",
              "content-length": String(zip.buffer.byteLength),
              "content-disposition": `attachment; filename="${zip.filename}"`,
              "cache-control": "no-store",
            },
          });
        } catch (error) {
          return errorResponse(error, "Falha ao preparar download");
        }
      },
    },
  },
});

async function buildExportZip(projectId: string, kind: ExportKind) {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const { spawn } = await import("node:child_process");

  const results = await ensureProjectResults(projectId);
  const cacheDir = path.join(results.appDir, ".cache", "exports");
  await fs.mkdir(cacheDir, { recursive: true });
  const tempDir = await fs.mkdtemp(path.join(cacheDir, `${kind}-`));
  const filename = `miniseed-${projectId}-${kind}.zip`;
  const zipPath = path.join(tempDir, filename);

  // The temporary folder goes away on failure too (a failed zip used to leave it behind).
  try {
    if (kind === "csv") {
      await runProcess(
        "zip",
        ["-j", "-q", zipPath, ...results.tableFiles],
        {
          cwd: results.outputDir,
        },
        spawn,
      );
    } else if (kind === "figures") {
      await runProcess(
        "zip",
        ["-j", "-q", zipPath, ...results.figureFiles],
        {
          cwd: results.outputDir,
        },
        spawn,
      );
    } else {
      await runProcess(
        "zip",
        [
          "-q",
          zipPath,
          ...TABLE_FILES.map((name) => `tabelas/${name}`),
          ...FIGURE_FILES.map((name) => `figuras/${name}`),
        ],
        {
          cwd: results.outputDir,
        },
        spawn,
      );
    }
    const buffer = await fs.readFile(zipPath);
    return { buffer, filename };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}
