// Project CRUD (mock). Replace with Supabase queries against `projects`.

import type { Project } from "./types";
import { nowIso, readKey, uid, writeKey } from "./store";

const KEY = "mss.projects";

export function listProjects(): Project[] {
  return readKey<Project[]>(KEY, []).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
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
  const all = readKey<Project[]>(KEY, []);
  all.push(project);
  writeKey(KEY, all);
  return project;
}

export function updateProject(id: string, patch: Partial<Project>): Project | undefined {
  const all = readKey<Project[]>(KEY, []);
  const idx = all.findIndex((p) => p.id === id);
  if (idx === -1) return undefined;
  all[idx] = { ...all[idx], ...patch, updatedAt: nowIso() };
  writeKey(KEY, all);
  return all[idx];
}

export function deleteProject(id: string) {
  writeKey(
    KEY,
    readKey<Project[]>(KEY, []).filter((p) => p.id !== id),
  );
  removeProjectRows("mss.files", id);
  removeProjectRows("mss.uploads", id);
  removeProjectRows("mss.jobs", id);
  removeProjectRows("mss.results", id);
}

function removeProjectRows(key: string, projectId: string) {
  const rows = readKey<Array<{ projectId?: string }>>(key, []);
  writeKey(
    key,
    rows.filter((row) => row.projectId !== projectId),
  );
}
