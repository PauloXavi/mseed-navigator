// Processing pipeline (mock).
// Real backend: enqueue a job on the Python worker and stream progress.

import type {
  JobStatus,
  ProcessingJob,
  ProcessingMode,
  ProcessingParameters,
  ProcessingStep,
} from "./types";
import { PROCESSING_STEPS } from "./types";
import { nowIso, readKey, uid, writeKey } from "./store";
import { generateMockResults } from "./mockData";
import { markFilesStatus } from "./files";
import { updateProject } from "./projects";

const KEY_JOBS = "mss.jobs";
const KEY_RESULTS = "mss.results";
const TIMERS = new Map<string, ReturnType<typeof setTimeout>>();

export function listJobs(projectId: string): ProcessingJob[] {
  return readKey<ProcessingJob[]>(KEY_JOBS, [])
    .filter((j) => j.projectId === projectId)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export function getActiveJob(projectId: string): ProcessingJob | undefined {
  return listJobs(projectId).find(
    (j) => j.status === "running" || j.status === "paused" || j.status === "queued",
  );
}

function saveJob(job: ProcessingJob) {
  const all = readKey<ProcessingJob[]>(KEY_JOBS, []);
  const idx = all.findIndex((j) => j.id === job.id);
  if (idx === -1) all.push(job);
  else all[idx] = job;
  writeKey(KEY_JOBS, all);
}

export interface StartJobInput {
  projectId: string;
  mode: ProcessingMode;
  fileIds: string[];
  parameters: ProcessingParameters;
}

export function startProcessingJob(input: StartJobInput): ProcessingJob {
  const stepProgress = Object.fromEntries(PROCESSING_STEPS.map((s) => [s.key, 0])) as Record<
    ProcessingStep,
    number
  >;

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
    stepProgress,
  };
  saveJob(job);
  updateProject(input.projectId, { status: "processing" });
  scheduleTick(job.id);
  return job;
}

export function pauseProcessingJob(jobId: string) {
  const job = getJob(jobId);
  if (!job) return;
  job.status = "paused";
  saveJob(job);
  clearTimer(jobId);
}

export function resumeProcessingJob(jobId: string) {
  const job = getJob(jobId);
  if (!job || job.status !== "paused") return;
  job.status = "running";
  saveJob(job);
  scheduleTick(jobId);
}

export function cancelProcessingJob(jobId: string) {
  const job = getJob(jobId);
  if (!job) return;
  job.status = "canceled";
  job.finishedAt = nowIso();
  saveJob(job);
  clearTimer(jobId);
  updateProject(job.projectId, { status: "ready" });
}

export function getProcessingProgress(jobId: string): ProcessingJob | undefined {
  return getJob(jobId);
}

function getJob(jobId: string): ProcessingJob | undefined {
  return readKey<ProcessingJob[]>(KEY_JOBS, []).find((j) => j.id === jobId);
}

function clearTimer(jobId: string) {
  const t = TIMERS.get(jobId);
  if (t) {
    clearTimeout(t);
    TIMERS.delete(jobId);
  }
}

function scheduleTick(jobId: string) {
  clearTimer(jobId);
  const t = setTimeout(() => tick(jobId), 350);
  TIMERS.set(jobId, t);
}

const STEP_ORDER: ProcessingStep[] = [
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

function tick(jobId: string) {
  const job = getJob(jobId);
  if (!job || job.status !== "running") return;

  const stepIdx = STEP_ORDER.indexOf(job.currentStep);
  const current = job.currentStep;
  job.stepProgress[current] = Math.min(100, (job.stepProgress[current] ?? 0) + 20);

  if (job.stepProgress[current] >= 100) {
    const next = STEP_ORDER[stepIdx + 1];
    if (next) job.currentStep = next;
  }

  const total =
    STEP_ORDER.reduce((acc, s) => acc + (job.stepProgress[s] ?? 0), 0) / STEP_ORDER.length;
  job.progress = Math.floor(total);

  if (job.currentStep === "export" && (job.stepProgress.export ?? 0) >= 100) {
    job.status = "completed";
    job.progress = 100;
    job.finishedAt = nowIso();
    saveJob(job);
    markFilesStatus(job.projectId, job.fileIds, "processed");
    updateProject(job.projectId, {
      status: "completed",
      lastProcessedAt: job.finishedAt,
    });
    persistResults(job.projectId, job.id);
    return;
  }

  saveJob(job);
  scheduleTick(jobId);
}

function persistResults(projectId: string, jobId: string) {
  const results = generateMockResults(projectId, jobId);
  const all = readKey<ReturnType<typeof generateMockResults>>(KEY_RESULTS, []);
  writeKey(KEY_RESULTS, [...all, ...results]);
}

export function setJobStatus(jobId: string, status: JobStatus) {
  const job = getJob(jobId);
  if (!job) return;
  job.status = status;
  saveJob(job);
}
