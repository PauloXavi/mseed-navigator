// Realistic mock generators for MiniSEED-like data.
// These functions never touch the network; they exist to make the UI feel
// alive until the Python/ObsPy backend is wired up.

import type { MseedFile, ProcessingResult } from "./types";
import { uid } from "./store";

const STATIONS = ["INV01", "INV02", "INV03", "MSR01", "MSR02"];
const CHANNELS = ["HHZ", "HHN", "HHE", "EHZ", "EHN", "EHE"];
const NETWORK = "IV";

function rand(seed: number) {
  // Deterministic-ish PRNG so mock lists are stable per project id.
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

function hashCode(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function generateMockMseedFiles(
  projectId: string,
  uploadId: string,
  count = 96,
): MseedFile[] {
  const rng = rand(hashCode(projectId));
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - 1);

  const station = STATIONS[Math.floor(rng() * STATIONS.length)];
  const files: MseedFile[] = [];

  for (let i = 0; i < count; i++) {
    const ch = CHANNELS[i % 3];
    const t0 = new Date(start.getTime() + Math.floor(i / 3) * 15 * 60 * 1000);
    const t1 = new Date(t0.getTime() + 15 * 60 * 1000);
    files.push({
      id: uid("file"),
      projectId,
      uploadId,
      fileName: `${NETWORK}.${station}..${ch}.D.${t0.toISOString().slice(0, 10)}.${String(Math.floor(i / 3)).padStart(3, "0")}.mseed`,
      extension: "mseed",
      sizeBytes: Math.floor(400_000 + rng() * 200_000),
      network: NETWORK,
      station,
      location: "",
      channel: ch,
      starttimeUtc: t0.toISOString(),
      endtimeUtc: t1.toISOString(),
      durationS: 900,
      samplingRateHz: 100,
      npts: 90000,
      status: "pending",
    });
  }
  return files;
}

export function generateTimeseries(points = 600, projectId = "seed") {
  const rng = rand(hashCode(projectId));
  const out: { t: number; v: number }[] = [];
  for (let i = 0; i < points; i++) {
    const base = Math.sin(i / 18) * 0.4 + Math.sin(i / 4) * 0.15;
    const noise = (rng() - 0.5) * 0.35;
    const spike = rng() > 0.995 ? (rng() > 0.5 ? 3 : -3) : 0;
    out.push({ t: i, v: base + noise + spike });
  }
  return out;
}

export function generatePsd(projectId = "seed") {
  const rng = rand(hashCode(projectId) + 7);
  const out: { f: number; raw: number; processed: number }[] = [];
  for (let i = 1; i <= 50; i++) {
    const bg = -140 + Math.log10(i) * 10;
    const noise = rng() * 4;
    const raw = bg + noise + (i < 3 ? 20 : 0);
    const processed = bg + noise * 0.6 - (i > 45 || i < 1 ? 15 : 0);
    out.push({ f: i, raw, processed });
  }
  return out;
}

export function generateStaLta(points = 400, projectId = "seed") {
  const rng = rand(hashCode(projectId) + 3);
  const out: { t: number; v: number; on: number; off: number }[] = [];
  for (let i = 0; i < points; i++) {
    const spike = i > 200 && i < 240 ? 6 + rng() * 3 : 1 + rng() * 0.8;
    out.push({ t: i, v: spike, on: 8, off: 2 });
  }
  return out;
}

export function generateEvents(projectId: string) {
  const rng = rand(hashCode(projectId) + 11);
  const events: {
    id: string;
    startUtc: string;
    endUtc: string;
    durationS: number;
    peakRatio: number;
    channel: string;
  }[] = [];
  const base = Date.now() - 24 * 3600 * 1000;
  const n = 8 + Math.floor(rng() * 6);
  for (let i = 0; i < n; i++) {
    const start = new Date(base + rng() * 24 * 3600 * 1000);
    const dur = 3 + rng() * 20;
    events.push({
      id: uid("evt"),
      startUtc: start.toISOString(),
      endUtc: new Date(start.getTime() + dur * 1000).toISOString(),
      durationS: +dur.toFixed(2),
      peakRatio: +(4 + rng() * 8).toFixed(2),
      channel: CHANNELS[Math.floor(rng() * 3)],
    });
  }
  return events.sort((a, b) => a.startUtc.localeCompare(b.startUtc));
}

export function generateGaps(projectId: string) {
  const rng = rand(hashCode(projectId) + 17);
  const gaps: { startUtc: string; endUtc: string; durationS: number; channel: string }[] = [];
  const n = Math.floor(rng() * 4);
  const base = Date.now() - 24 * 3600 * 1000;
  for (let i = 0; i < n; i++) {
    const start = new Date(base + rng() * 24 * 3600 * 1000);
    const dur = 1 + rng() * 30;
    gaps.push({
      startUtc: start.toISOString(),
      endUtc: new Date(start.getTime() + dur * 1000).toISOString(),
      durationS: +dur.toFixed(2),
      channel: CHANNELS[Math.floor(rng() * 3)],
    });
  }
  return gaps;
}

export function generateBandEnergy(projectId: string) {
  const rng = rand(hashCode(projectId) + 23);
  const bands = [
    { band: "0.1–1 Hz", lo: 0.1, hi: 1 },
    { band: "1–5 Hz", lo: 1, hi: 5 },
    { band: "5–15 Hz", lo: 5, hi: 15 },
    { band: "15–30 Hz", lo: 15, hi: 30 },
    { band: "30–45 Hz", lo: 30, hi: 45 },
  ];
  return bands.map((b) => ({ ...b, energy: +(rng() * 100).toFixed(2) }));
}

export function generateOverview24h(projectId: string) {
  const rng = rand(hashCode(projectId) + 31);
  const out: { minute: number; rms: number; peak: number }[] = [];
  for (let i = 0; i < 24 * 60; i += 5) {
    const rms = 0.08 + Math.sin(i / 60) * 0.02 + rng() * 0.02;
    const peak = rms * (4 + rng() * 6);
    out.push({ minute: i, rms: +rms.toFixed(4), peak: +peak.toFixed(4) });
  }
  return out;
}

export function generateMockResults(projectId: string, jobId: string): ProcessingResult[] {
  const now = new Date().toISOString();
  const items: ProcessingResult["resultType"][] = [
    "summary_global",
    "summary_per_file",
    "gaps",
    "spikes",
    "psd_welch",
    "band_energy",
    "sta_lta_events",
    "figure",
  ];
  return items.map((t) => ({
    id: uid("res"),
    projectId,
    jobId,
    resultType: t,
    title: t,
    storagePath: `results/${projectId}/${jobId}/${t}`,
    metadata: {},
    createdAt: now,
  }));
}
