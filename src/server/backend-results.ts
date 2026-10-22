import type { ChildProcess } from "node:child_process";

import { CSV_FILES, FIGURE_FILES, PARAMS_FILE, TABLE_FILES } from "@/lib/artifacts";
import { filterUses, validateParameters } from "@/services/parameters";
import type { ProcessingParameters } from "@/services/types";

export { CSV_FILES, FIGURE_FILES, PARAMS_FILE, TABLE_FILES };

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function errorResponse(error: unknown, fallbackMessage: string) {
  const message = error instanceof Error ? error.message : fallbackMessage;
  const status = error instanceof HttpError ? error.status : 500;
  return Response.json({ error: message }, { status });
}

export function assertValidProjectId(projectId: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(projectId)) {
    throw new HttpError(400, "projectId inválido");
  }
}

export async function getProjectPaths(projectId: string) {
  assertValidProjectId(projectId);
  const path = await import("node:path");

  const appDir = process.cwd();
  const outputDir = path.join(appDir, "public", "backend-results", projectId);
  return {
    appDir,
    outputDir,
    tableDir: path.join(outputDir, "tabelas"),
    figureDir: path.join(outputDir, "figuras"),
    dataDir: await resolveDataDir(appDir),
    scriptPath: path.join(appDir, "backend", "mseed_processing.py"),
    progressFile: path.join(appDir, ".cache", "jobs", `${projectId}.json`),
    // File inventory for the Files/Inspection tabs, independent of which files a run used.
    inventoryDir: path.join(appDir, ".cache", "inventory", projectId),
  };
}

/**
 * MiniSEED directory: MSEED_DATA_DIR, else a dados/ folder next to the app (../dados),
 * else the synthetic demo shipped with the app.
 */
async function resolveDataDir(appDir: string) {
  const path = await import("node:path");
  if (process.env.MSEED_DATA_DIR) return path.resolve(appDir, process.env.MSEED_DATA_DIR);
  const workspaceData = path.resolve(appDir, "..", "dados");
  if (await fileExists(workspaceData)) return workspaceData;
  return path.join(appDir, "examples", "data");
}

/** Python of the app's .venv, else of the workspace .venv (../.venv), else python3. */
export async function resolvePython(appDir: string) {
  const path = await import("node:path");
  const candidates = [
    path.join(appDir, ".venv", "bin", "python"),
    path.resolve(appDir, "..", ".venv", "bin", "python"),
  ];
  for (const candidate of candidates) {
    if (await fileExists(candidate)) return candidate;
  }
  return "python3";
}

// -----------------------------------------------------------------------------
// Per-project queue: only one Python run may write a project's outputs at a time.
// Concurrent requests (Files, Inspection and Results tabs load in parallel) wait
// for the run in progress and then re-check the outputs instead of spawning again.
// -----------------------------------------------------------------------------

const projectLocks = new Map<string, Promise<void>>();

async function withProjectLock<T>(projectId: string, task: () => Promise<T>): Promise<T> {
  const previous = projectLocks.get(projectId) ?? Promise.resolve();
  let release: () => void = () => undefined;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.then(() => current);
  projectLocks.set(projectId, queued);

  await previous;
  try {
    return await task();
  } finally {
    release();
    if (projectLocks.get(projectId) === queued) projectLocks.delete(projectId);
  }
}

/**
 * Runs the pipeline into a staging directory and swaps it in only on success, so a
 * failed or canceled run never leaves a mix of old and new artifacts behind.
 */
async function runPipeline(
  projectId: string,
  extraArgs: string[],
  options: { targetDir?: string; onSpawn?: (child: ChildProcess) => void } = {},
) {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const { spawn } = await import("node:child_process");

  const paths = await getProjectPaths(projectId);
  const targetDir = options.targetDir ?? paths.outputDir;
  const stagingDir = `${targetDir}.staging`;
  const python = await resolvePython(paths.appDir);
  const mplConfigDir = path.join(paths.appDir, ".cache", "matplotlib");
  await fs.mkdir(mplConfigDir, { recursive: true });
  await fs.rm(stagingDir, { recursive: true, force: true });

  try {
    await runProcess(
      python,
      [paths.scriptPath, "--data-dir", paths.dataDir, "--output-dir", stagingDir, ...extraArgs],
      {
        cwd: paths.appDir,
        env: { ...process.env, MPLCONFIGDIR: mplConfigDir, PYTHONUNBUFFERED: "1" },
      },
      spawn,
      options.onSpawn,
    );
    // The previous results are removed only once the new ones exist, and come back if the
    // swap fails: deleting first lost them whenever the run produced no output.
    if (!(await fileExists(stagingDir))) {
      throw new Error("O processamento terminou sem gerar resultados.");
    }
    const backupDir = `${targetDir}.previous`;
    await fs.rm(backupDir, { recursive: true, force: true });
    await fs.mkdir(path.dirname(targetDir), { recursive: true });
    const hadPrevious = await fileExists(targetDir);
    if (hadPrevious) await fs.rename(targetDir, backupDir);
    try {
      await fs.rename(stagingDir, targetDir);
    } catch (error) {
      if (hadPrevious) await fs.rename(backupDir, targetDir);
      throw error;
    }
    await fs.rm(backupDir, { recursive: true, force: true });
  } catch (error) {
    await fs.rm(stagingDir, { recursive: true, force: true });
    throw error;
  }
}

export async function ensureProjectResults(projectId: string, force = false) {
  const path = await import("node:path");
  const paths = await getProjectPaths(projectId);

  await withProjectLock(projectId, async () => {
    const expectedPaths = [
      ...TABLE_FILES.map((name) => path.join(paths.tableDir, name)),
      ...FIGURE_FILES.map((name) => path.join(paths.figureDir, name)),
    ];
    const existing = await Promise.all(expectedPaths.map(fileExists));
    // Results produced by older pipeline versions lack the newer artifacts and are regenerated.
    if (force || existing.some((ok) => !ok)) {
      await runPipeline(projectId, []);
    }
  });

  return {
    ...paths,
    csvFiles: CSV_FILES.map((name) => path.join(paths.tableDir, name)),
    tableFiles: TABLE_FILES.map((name) => path.join(paths.tableDir, name)),
    figureFiles: FIGURE_FILES.map((name) => path.join(paths.figureDir, name)),
    figures: await figureUrls(projectId, paths.figureDir),
  };
}

/** Lightweight path for the file list: per-file metadata of every file, without the analysis. */
export async function ensureFileMetadata(projectId: string) {
  const path = await import("node:path");
  const paths = await getProjectPaths(projectId);
  const summaryPath = path.join(paths.inventoryDir, "tabelas", "resumo_por_arquivo.csv");

  await withProjectLock(projectId, async () => {
    if (!(await fileExists(summaryPath))) {
      await runPipeline(projectId, ["--metadata-only"], { targetDir: paths.inventoryDir });
    }
  });
  return { ...paths, summaryPath };
}

export async function deleteProjectArtifacts(projectId: string) {
  const fs = await import("node:fs/promises");
  const paths = await getProjectPaths(projectId);
  await cancelProcessing(projectId);
  jobs.delete(projectId);
  await Promise.all(
    [paths.outputDir, paths.inventoryDir, paths.progressFile].map((target) =>
      fs.rm(target, { recursive: true, force: true }),
    ),
  );
}

async function figureUrls(projectId: string, figureDir: string) {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  return Promise.all(
    FIGURE_FILES.map(async (name) => {
      // The modification time busts the browser cache after reprocessing.
      const stat = await fs.stat(path.join(figureDir, name)).catch(() => null);
      const version = stat ? Math.round(stat.mtimeMs) : 0;
      return { name, url: `/backend-results/${projectId}/figuras/${name}?v=${version}` };
    }),
  );
}

// -----------------------------------------------------------------------------
// Processing jobs started from the UI with user-defined parameters
// -----------------------------------------------------------------------------

type JobStatus = "running" | "completed" | "error" | "canceled";

interface JobState {
  status: JobStatus;
  startedAt: string;
  finishedAt?: string;
  error?: string;
  child?: ChildProcess;
}

const jobs = new Map<string, JobState>();

export function buildPipelineArgs(params: ProcessingParameters, fileNames: string[] = []) {
  const errors = validateParameters(params);
  if (errors.length) throw new HttpError(400, `Parâmetros inválidos: ${errors.join("; ")}`);

  const toggle = (enabled: boolean, flag: string) => (enabled ? `--${flag}` : `--no-${flag}`);
  const uses = filterUses(params.filterType);
  const args = [
    "--filter-type",
    params.filterType,
    "--filter-family",
    params.filterFamily,
    // A limit the filter type does not use is left out (Python keeps its default).
    ...(uses.min ? ["--freqmin", String(params.freqmin)] : []),
    ...(uses.max ? ["--freqmax", String(params.freqmax)] : []),
    "--filter-order",
    String(params.filterOrder),
    toggle(params.zeroPhase, "zero-phase"),
    toggle(params.notch, "notch"),
    ...(params.notch
      ? ["--notch-freqs", params.notchFreqs.join(","), "--notch-q", String(params.notchQ)]
      : []),
    "--spike-method",
    params.spikeMethod,
    "--spike-z",
    String(params.spikeZ),
    "--spike-window",
    String(params.spikeWindow),
    "--spike-max-width",
    String(params.spikeMaxWidth),
    "--taper-seconds",
    String(params.taperSeconds),
    "--taper-max-fraction",
    String(params.taperMaxFraction),
    "--gap-fill",
    params.gapFill,
    "--qc-window-seconds",
    String(params.qcWindowSeconds),
    "--welch-nperseg",
    String(params.welchNperseg),
    "--stalta-method",
    params.staltaMethod,
    "--sta",
    String(params.sta),
    "--lta",
    String(params.lta),
    "--trigger-on",
    String(params.triggerOn),
    "--trigger-off",
    String(params.triggerOff),
    "--max-event-seconds",
    String(params.maxEventSeconds),
    "--min-event-seconds",
    String(params.minEventSeconds),
    toggle(params.lowSnrFlag, "low-snr-flag"),
    "--low-snr-threshold",
    String(params.lowSnrThreshold),
    "--min-event-snr",
    String(params.minEventSnr),
    toggle(params.steps.despike, "despike"),
    toggle(params.steps.demean, "demean"),
    toggle(params.steps.detrend, "detrend"),
    toggle(params.steps.taper, "taper"),
    toggle(params.steps.bandpass, "bandpass"),
    toggle(params.steps.psdWelch, "psd"),
    toggle(params.steps.spectrogram, "spectrogram"),
    toggle(params.steps.staLta, "stalta"),
  ];
  if (params.traceId) args.push("--trace-id", params.traceId);

  // File names become CLI arguments: a name starting with "-" would be parsed as an option
  // (e.g. "--output-dir=.." writes outside the project), so only plain names are accepted.
  if (fileNames.length > MAX_FILE_NAMES) {
    throw new HttpError(400, `Seleção com arquivos demais (máximo ${MAX_FILE_NAMES}).`);
  }
  if (fileNames.some((name) => !SAFE_FILE_NAME.test(name))) {
    throw new HttpError(400, "Nome de arquivo inválido na seleção.");
  }
  if (fileNames.length) args.push("--files", ...fileNames);
  return args;
}

const MAX_FILE_NAMES = 10_000;
/**
 * A MiniSEED file name: no path separators and no leading "-" (or "."). Letters may be
 * accented, precomposed or decomposed (macOS can keep "ç" as "c" + combining cedilla).
 */
const SAFE_FILE_NAME = /^[\p{L}\p{N}_%+@=,][\p{L}\p{M}\p{N}_%+@=,. -]{0,254}$/u;

export async function startProcessing(
  projectId: string,
  params: ProcessingParameters,
  fileNames: string[] = [],
) {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const paths = await getProjectPaths(projectId);

  if (jobs.get(projectId)?.status === "running") {
    throw new HttpError(409, "Já existe um processamento em andamento para este projeto.");
  }
  const args = buildPipelineArgs(params, fileNames);

  const job: JobState = { status: "running", startedAt: new Date().toISOString() };
  jobs.set(projectId, job);
  await fs.mkdir(path.dirname(paths.progressFile), { recursive: true });
  await fs.rm(paths.progressFile, { force: true });

  void withProjectLock(projectId, async () => {
    if (job.status !== "running") return; // canceled while waiting in the queue
    await runPipeline(projectId, ["--progress-file", paths.progressFile, ...args], {
      onSpawn: (child) => {
        job.child = child;
      },
    });
  })
    .then(() => {
      if (job.status === "running") job.status = "completed";
    })
    .catch((error: unknown) => {
      if (job.status === "running") {
        job.status = "error";
        job.error =
          error instanceof Error ? stripServerPaths(error.message) : "Falha no processamento";
      }
    })
    .finally(() => {
      job.finishedAt = new Date().toISOString();
      job.child = undefined;
    });

  return getProcessingStatus(projectId);
}

export async function getProcessingStatus(projectId: string) {
  const fs = await import("node:fs/promises");
  const paths = await getProjectPaths(projectId);
  const job = jobs.get(projectId);
  if (!job) return { status: "idle" as const, progress: 0 };

  const progress = await fs
    .readFile(paths.progressFile, "utf8")
    .then(
      (content) => JSON.parse(content) as { step?: string; progress?: number; message?: string },
    )
    .catch(() => ({}) as { step?: string; progress?: number; message?: string });

  return {
    status: job.status,
    step: progress.step ?? "read",
    progress: job.status === "completed" ? 100 : (progress.progress ?? 0),
    message: progress.message,
    error: job.error,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  };
}

export async function cancelProcessing(projectId: string) {
  assertValidProjectId(projectId);
  const job = jobs.get(projectId);
  if (job?.status === "running") {
    job.status = "canceled";
    job.child?.kill("SIGTERM");
  }
  return getProcessingStatus(projectId);
}

// -----------------------------------------------------------------------------
// Process helpers
// -----------------------------------------------------------------------------

export async function fileExists(filePath: string) {
  const fs = await import("node:fs/promises");
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export function runProcess(
  command: string,
  args: string[],
  options: {
    cwd: string;
    env?: NodeJS.ProcessEnv;
  },
  spawn: typeof import("node:child_process").spawn,
  onSpawn?: (child: ChildProcess) => void,
) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, options);
    onSpawn?.(child);
    let output = "";

    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      if (signal) {
        reject(new Error(`Processo interrompido (${signal})`));
        return;
      }
      reject(new Error(publicProcessError(output)));
    });
  });
}

// Terminal colour codes (ESC [ ... m) that Python 3.13+ adds to its error messages.
const ANSI_CODES = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

/** Removes absolute server paths from a message (keeps only the last path component). */
export function stripServerPaths(message: string) {
  const roots = [process.cwd(), process.cwd().replace(/[\\/][^\\/]+$/, "")];
  let text = message;
  for (const root of roots.filter(Boolean))
    text = text
      .split(root + "/")
      .join("")
      .split(root)
      .join("");
  return text.replace(/(?:\/[\w.@-]+)+\/([\w.@-]+)/g, "$1");
}

/**
 * Message of a failed run that is safe to show in the UI: only the pipeline's own "Erro:"
 * lines, argparse errors or zip messages, without colour codes or server paths. Anything else
 * (a traceback) becomes a generic message; the full output goes to the server log.
 */
export function publicProcessError(output: string, fallback = "Falha interna no processamento.") {
  const lines = output
    .replace(ANSI_CODES, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const explicit = lines.filter((line) => /^Erro:|: error:|^zip (warning|error):/.test(line));
  if (explicit.length) return stripServerPaths(explicit.join("\n"));
  if (lines.length) console.error(output);
  return `${fallback} Detalhes no log do servidor.`;
}
