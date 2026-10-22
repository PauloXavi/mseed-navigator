// Upload + extraction pipeline (mock).
// Contract to preserve when wiring the real backend:
//   uploadZip(projectId, file) -> UploadRecord (progress via callback)
//   extractArchive(projectId, uploadId) -> resolves when files are scanned

import type { UploadRecord } from "./types";
import { nowIso, readList, uid, writeKey } from "./store";
import { generateMockMseedFiles } from "./mockData";
import { writeFiles } from "./files";
import { updateProject } from "./projects";

const KEY = "mss.uploads";

export function listUploads(projectId: string): UploadRecord[] {
  return readList<UploadRecord>(KEY)
    .filter((u) => u.projectId === projectId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function saveUpload(u: UploadRecord) {
  const all = readList<UploadRecord>(KEY);
  const idx = all.findIndex((x) => x.id === u.id);
  if (idx === -1) all.push(u);
  else all[idx] = u;
  writeKey(KEY, all);
}

export async function uploadZip(
  projectId: string,
  file: File,
  onProgress?: (u: UploadRecord) => void,
): Promise<UploadRecord> {
  const upload: UploadRecord = {
    id: uid("upl"),
    projectId,
    fileName: file.name,
    sizeBytes: file.size,
    status: "uploading",
    progress: 0,
    createdAt: nowIso(),
  };
  saveUpload(upload);
  updateProject(projectId, { status: "uploading" });
  onProgress?.(upload);

  // Simulated progressive upload.
  for (let p = 10; p <= 100; p += 10) {
    await sleep(120);
    upload.progress = p;
    saveUpload(upload);
    onProgress?.({ ...upload });
  }
  upload.status = "extracting";
  saveUpload(upload);
  onProgress?.({ ...upload });
  return upload;
}

export async function extractArchive(
  projectId: string,
  uploadId: string,
  onProgress?: (u: UploadRecord) => void,
): Promise<UploadRecord> {
  const all = readList<UploadRecord>(KEY);
  const upload = all.find((u) => u.id === uploadId);
  if (!upload) throw new Error("Upload not found");

  upload.status = "extracting";
  upload.progress = 0;
  saveUpload(upload);
  onProgress?.({ ...upload });

  for (let p = 20; p <= 100; p += 20) {
    await sleep(200);
    upload.progress = p;
    saveUpload(upload);
    onProgress?.({ ...upload });
  }

  const files = generateMockMseedFiles(projectId, uploadId);
  writeFiles(projectId, files);

  const ignored = Math.floor(Math.random() * 6);
  upload.status = "ready";
  upload.totalFiles = files.length + ignored;
  upload.mseedFiles = files.length;
  upload.ignoredFiles = ignored;
  saveUpload(upload);
  updateProject(projectId, { status: "ready", fileCount: files.length });
  onProgress?.({ ...upload });
  return upload;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
