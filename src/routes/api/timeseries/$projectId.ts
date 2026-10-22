import { createFileRoute } from "@tanstack/react-router";

import {
  HttpError,
  errorResponse,
  getProjectPaths,
  publicProcessError,
  resolvePython,
} from "@/server/backend-results";
import { FILTER_TYPES, filterUses, parseFrequencyList } from "@/services/parameters";
import type { FilterType } from "@/services/types";

export const Route = createFileRoute("/api/timeseries/$projectId")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        try {
          const url = new URL(request.url);
          const start = url.searchParams.get("start") ?? "";
          const end = url.searchParams.get("end") ?? "";
          const maxPoints = Number(url.searchParams.get("maxPoints") ?? "900");
          const traceId = url.searchParams.get("traceId") ?? "";
          const filterType = url.searchParams.get("filterType");
          const freqmin = url.searchParams.get("freqmin");
          const freqmax = url.searchParams.get("freqmax");
          const notchFreqs = url.searchParams.get("notchFreqs");
          const notchQ = url.searchParams.get("notchQ");

          if (!start || !end) {
            throw new HttpError(400, "Informe início e fim UTC.");
          }
          // Validated here so the Python script only ever receives ISO timestamps.
          const startMs = parseUtc(start);
          const endMs = parseUtc(end);
          if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
            throw new HttpError(400, "Início ou fim UTC inválido (use AAAA-MM-DDTHH:MM).");
          }
          if (endMs <= startMs) throw new HttpError(400, "O fim precisa ser depois do início.");
          if (endMs - startMs > MAX_WINDOW_MS) {
            throw new HttpError(400, "Janela longa demais (máximo de 48 h).");
          }
          if (traceId && !/^(?!-)[\w*?.-]+$/.test(traceId)) {
            throw new HttpError(400, "traceId inválido.");
          }

          const args = [
            "--start",
            new Date(startMs).toISOString(),
            "--end",
            new Date(endMs).toISOString(),
            "--max-points",
            // Bounds the JSON payload regardless of what the client asks for.
            String(Number.isFinite(maxPoints) ? Math.min(5000, Math.max(10, maxPoints)) : 900),
          ];
          if (traceId) args.push("--trace-id", traceId);
          args.push(...filterArgs(filterType, freqmin, freqmax, notchFreqs, notchQ));

          const payload = await extractTimeseries(params.projectId, args);
          return Response.json(payload);
        } catch (error) {
          return errorResponse(error, "Falha ao carregar série temporal");
        }
      },
    },
  },
});

async function extractTimeseries(projectId: string, args: string[]) {
  const path = await import("node:path");
  const { spawn } = await import("node:child_process");

  const paths = await getProjectPaths(projectId);
  const scriptPath = path.join(paths.appDir, "src", "server", "extract_timeseries.py");
  const python = await resolvePython(paths.appDir);

  const output = await runJsonProcess(
    python,
    [scriptPath, "--data-dir", paths.dataDir, ...args],
    { cwd: paths.appDir },
    spawn,
  );

  return JSON.parse(output) as unknown;
}

/**
 * Live-filter flags for extract_timeseries.py, validated with the same rules as the pipeline.
 * Without `filterType`, freqmin + freqmax still mean a band-pass (older clients).
 */
function filterArgs(
  filterType: string | null,
  freqmin: string | null,
  freqmax: string | null,
  notchFreqs: string | null,
  notchQ: string | null,
) {
  const args: string[] = [];
  const type = filterType ?? (freqmin !== null && freqmax !== null ? "bandpass" : null);
  if (type !== null) {
    if (!(FILTER_TYPES as readonly string[]).includes(type)) {
      throw new HttpError(400, "Tipo de filtro inválido.");
    }
    const uses = filterUses(type as FilterType);
    const fmin = Number(freqmin);
    const fmax = Number(freqmax);
    if (uses.min && !(Number.isFinite(fmin) && fmin > 0)) {
      throw new HttpError(400, "freqmin inválida.");
    }
    if (uses.max && !(Number.isFinite(fmax) && fmax > 0)) {
      throw new HttpError(400, "freqmax inválida.");
    }
    if (uses.min && uses.max && fmax <= fmin) throw new HttpError(400, "Banda de filtro inválida.");
    args.push("--filter-type", type);
    if (uses.min) args.push("--freqmin", String(fmin));
    if (uses.max) args.push("--freqmax", String(fmax));
  }
  if (notchFreqs) {
    const freqs = parseFrequencyList(notchFreqs);
    const q = notchQ === null ? 30 : Number(notchQ);
    if (
      freqs.length === 0 ||
      freqs.length > 20 ||
      freqs.some((f) => !Number.isFinite(f) || f <= 0)
    ) {
      throw new HttpError(400, "Frequências de notch inválidas.");
    }
    if (!Number.isFinite(q) || q <= 0) throw new HttpError(400, "Q do notch inválido.");
    args.push("--notch-freqs", freqs.join(","), "--notch-q", String(q));
  }
  return args;
}

const MAX_WINDOW_MS = 48 * 3600 * 1000;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?Z$/;

/** Strict ISO UTC timestamp to epoch ms (NaN otherwise; Date.parse alone accepts "abc:00Z"). */
function parseUtc(value: string) {
  const iso = toUtcIso(value);
  return ISO_UTC.test(iso) ? Date.parse(iso) : Number.NaN;
}

function toUtcIso(value: string) {
  return value.endsWith("Z") ? value : `${value}:00Z`;
}

function runJsonProcess(
  command: string,
  args: string[],
  options: { cwd: string },
  spawn: typeof import("node:child_process").spawn,
) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, options);
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }
      reject(new Error(publicProcessError(stderr, "Falha ao ler a série temporal.")));
    });
  });
}
