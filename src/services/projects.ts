// Project CRUD (mock). Replace with Supabase queries against `projects`.

import type { Project, ProjectStatus } from "./types";
import { nowIso, readList, uid, writeKey } from "./store";

const KEY = "mss.projects";
const PROJECT_STATUSES: ProjectStatus[] = [
  "created",
  "uploading",
  "ready",
  "processing",
  "completed",
  "error",
];

/** Fills fields missing from projects saved by older versions (or edited by hand). */
function normalizeProject(raw: Partial<Project>): Project | null {
  if (typeof raw.id !== "string" || !raw.id) return null;
  const epoch = new Date(0).toISOString();
  return {
    ...raw,
    id: raw.id,
    name: typeof raw.name === "string" && raw.name ? raw.name : "Projeto sem nome",
    status: PROJECT_STATUSES.includes(raw.status as ProjectStatus)
      ? (raw.status as ProjectStatus)
      : "created",
    fileCount: typeof raw.fileCount === "number" ? raw.fileCount : 0,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : epoch,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : epoch,
  };
}

function readProjects(): Project[] {
  return readList<Partial<Project>>(KEY)
    .map(normalizeProject)
    .filter((p): p is Project => p !== null);
}

export function listProjects(): Project[] {
  return readProjects().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getProject(id: string): Project | undefined {
  return listProjects().find((p) => p.id === id);
}

export interface CreateProjectInput {
  name: string;
  description?: string;
  station?: string;
  channel?: string;
}

export function createProject(input: CreateProjectInput): Project {
  const now = nowIso();
  const project: Project = {
    id: uid("prj"),
    name: input.name.trim(),
    description: input.description?.trim(),
    station: input.station?.trim(),
    channel: input.channel?.trim(),
    status: "created",
    fileCount: 0,
    createdAt: now,
    updatedAt: now,
  };
  const all = readProjects();
  all.push(project);
  writeKey(KEY, all);
  return project;
}

export function updateProject(id: string, patch: Partial<Project>): Project | undefined {
  const all = readProjects();
  const idx = all.findIndex((p) => p.id === id);
  if (idx === -1) return undefined;
  all[idx] = { ...all[idx], ...patch, updatedAt: nowIso() };
  writeKey(KEY, all);
  return all[idx];
}

export function deleteProject(id: string) {
  writeKey(
    KEY,
    readProjects().filter((p) => p.id !== id),
  );
  removeProjectRows("mss.files", id);
  removeProjectRows("mss.uploads", id);
  removeProjectRows("mss.jobs", id);
  removeProjectRows("mss.results", id);
}

function removeProjectRows(key: string, projectId: string) {
  const rows = readList<{ projectId?: string }>(key);
  writeKey(
    key,
    rows.filter((row) => row.projectId !== projectId),
  );
}
