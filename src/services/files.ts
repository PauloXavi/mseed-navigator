// MiniSEED file registry (mock).
// Real backend: scan extracted archive, run obspy.read for metadata.

import type { MseedFile, MseedFileStatus } from "./types";
import { readKey, writeKey } from "./store";

const KEY = "mss.files";

export function listFiles(projectId: string): MseedFile[] {
  return readKey<MseedFile[]>(KEY, [])
    .filter((f) => f.projectId === projectId)
    .sort((a, b) => a.starttimeUtc.localeCompare(b.starttimeUtc));
}

export function writeFiles(projectId: string, files: MseedFile[]) {
  const all = readKey<MseedFile[]>(KEY, []).filter((f) => f.projectId !== projectId);
  writeKey(KEY, [...all, ...files]);
}

export function scanMiniSeedFiles(projectId: string): MseedFile[] {
  // In the real backend this walks the extracted archive.
  return listFiles(projectId);
}

export async function readMiniSeedMetadata(
  projectId: string,
  fileIds: string[],
): Promise<MseedFile[]> {
  const all = readKey<MseedFile[]>(KEY, []);
  const updated = all.map((f) =>
    f.projectId === projectId && fileIds.includes(f.id)
      ? { ...f, status: "read" as MseedFileStatus }
      : f,
  );
  writeKey(KEY, updated);
  await new Promise((r) => setTimeout(r, 250));
  return updated.filter((f) => f.projectId === projectId && fileIds.includes(f.id));
}

export function markFilesStatus(projectId: string, fileIds: string[], status: MseedFileStatus) {
  const all = readKey<MseedFile[]>(KEY, []);
  writeKey(
    KEY,
    all.map((f) => (f.projectId === projectId && fileIds.includes(f.id) ? { ...f, status } : f)),
  );
}
