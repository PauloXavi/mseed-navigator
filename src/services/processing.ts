// Processing jobs.
// The job runs backend/mseed_processing.py on the server (POST /api/process/:projectId)
// with the user's parameters; progress comes from the pipeline's progress file.
// localStorage keeps the job history so the Results tab knows a run has completed.

import type { ProcessingJob, ProcessingMode, ProcessingParameters, ProcessingStep } from "./types";
import { PROCESSING_STEPS } from "./types";
import { nowIso, readKey, readList, uid, writeKey } from "./store";
import { generateMockResults } from "./mockData";
import { markFilesStatus } from "./files";
import { updateProject } from "./projects";
import { withParameterDefaults } from "./parameters";

const KEY_JOBS = "mss.jobs";
const KEY_RESULTS = "mss.results";

// Steps reported by the Python pipeline, in execution order.
const BACKEND_STEPS: ProcessingStep[] = [
  "read",
  "qc",
  "despike",
  "preprocess",
  "bandpass",
  "psd",
  "stalta",
  "figures",
  "export",
];

interface ServerJobStatus {
  status: "idle" | "running" | "completed" | "error" | "canceled";
  step?: string;
  progress: number;
  message?: string;
  error?: string;
}

/** Stored jobs, skipping entries without the fields the UI relies on (old/corrupted data). */
function readJobs(): ProcessingJob[] {
  return readList<ProcessingJob>(KEY_JOBS).filter(
    (j) =>
      typeof j.id === "string" &&
      typeof j.projectId === "string" &&
      typeof j.startedAt === "string" &&
      typeof j.status === "string",
  );
}

export function listJobs(projectId: string): ProcessingJob[] {
  return readJobs()
    .filter((j) => j.projectId === projectId)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export function getActiveJob(projectId: string): ProcessingJob | undefined {
  return listJobs(projectId).find((j) => j.status === "running" || j.status === "queued");
}

/** Parameters of the most recent job (so the form reopens with the last configuration). */
export function getLastParameters(projectId: string): ProcessingParameters {
  return withParameterDefaults(listJobs(projectId)[0]?.parameters);
}

function saveJob(job: ProcessingJob) {
  const all = readJobs();
  const idx = all.findIndex((j) => j.id === job.id);
  if (idx === -1) all.push(job);
  else all[idx] = job;
  writeKey(KEY_JOBS, all);
}

function getJob(jobId: string): ProcessingJob | undefined {
  return readJobs().find((j) => j.id === jobId);
}

export interface StartJobInput {
  projectId: string;
  mode: ProcessingMode;
  fileIds: string[];
  fileNames: string[];
  parameters: ProcessingParameters;
}

export async function startProcessingJob(input: StartJobInput): Promise<ProcessingJob> {
  const response = await fetch(`/api/process/${input.projectId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ parameters: input.parameters, fileNames: input.fileNames }),
  });
  const payload = (await response.json()) as ServerJobStatus & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "Falha ao iniciar processamento");

  const job: ProcessingJob = {
    id: uid("job"),
    projectId: input.projectId,
    status: "running",
    mode: input.mode,
    parameters: input.parameters,
    progress: 0,
    currentStep: "read",
    startedAt: nowIso(),
    fileIds: input.fileIds,
    stepProgress: stepProgressFor("read", false),
  };
  saveJob(job);
  updateProject(input.projectId, { status: "processing" });
  return job;
}

/** Polls the server and updates the stored job; returns the updated copy. */
export async function refreshProcessingJob(jobId: string): Promise<ProcessingJob | undefined> {
  const job = getJob(jobId);
  if (!job || job.status !== "running") return job;

  const response = await fetch(`/api/process/${job.projectId}`);
  const server = (await response.json()) as ServerJobStatus;
  if (!response.ok) throw new Error(server.error ?? "Falha ao consultar processamento");

  const step = BACKEND_STEPS.includes(server.step as ProcessingStep)
    ? (server.step as ProcessingStep)
    : job.currentStep;
  job.currentStep = step;
  job.progress = Math.max(job.progress, Math.round(server.progress));
  job.stepProgress = stepProgressFor(step, server.status === "completed");

  if (server.status === "completed") {
    job.status = "completed";
    job.progress = 100;
    job.finishedAt = nowIso();
    markFilesStatus(job.projectId, job.fileIds, "processed");
    updateProject(job.projectId, { status: "completed", lastProcessedAt: job.finishedAt });
    persistResults(job.projectId, job.id);
  } else if (server.status === "error" || server.status === "idle") {
    job.status = "error";
    job.finishedAt = nowIso();
    job.errorMessage =
      server.status === "idle"
        ? "O servidor não tem registro deste processamento (foi reiniciado?)."
        : (server.error ?? "Falha no processamento");
    updateProject(job.projectId, { status: "error" });
  } else if (server.status === "canceled") {
    job.status = "canceled";
    job.finishedAt = nowIso();
    updateProject(job.projectId, { status: "ready" });
  }

  saveJob(job);
  return { ...job };
}

export async function cancelProcessingJob(jobId: string) {
  const job = getJob(jobId);
  if (!job) return;
  await fetch(`/api/process/${job.projectId}`, { method: "DELETE" }).catch(() => undefined);
  job.status = "canceled";
  job.finishedAt = nowIso();
  saveJob(job);
  updateProject(job.projectId, { status: "ready" });
}

export function getProcessingProgress(jobId: string): ProcessingJob | undefined {
  return getJob(jobId);
}

function stepProgressFor(current: ProcessingStep, completed: boolean) {
  const currentIndex = BACKEND_STEPS.indexOf(current);
  return Object.fromEntries(
    PROCESSING_STEPS.map(({ key }) => {
      // Upload/extraction happen before processing starts.
      if (completed || key === "upload" || key === "extract") return [key, 100];
      const index = BACKEND_STEPS.indexOf(key);
      return [key, index < currentIndex ? 100 : index === currentIndex ? 50 : 0];
    }),
  ) as Record<ProcessingStep, number>;
}

function persistResults(projectId: string, jobId: string) {
  const results = generateMockResults(projectId, jobId);
  const all = readList<ReturnType<typeof generateMockResults>[number]>(KEY_RESULTS);
  writeKey(KEY_RESULTS, [...all, ...results]);
}
