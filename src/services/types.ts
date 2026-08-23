// Domain types for mSEED Navigator.
// Kept UI-agnostic so a future Python/ObsPy worker can implement the same
// service contracts without touching components.

export type ProjectStatus =
  "created" | "uploading" | "ready" | "processing" | "completed" | "error";

export interface Project {
  id: string;
  name: string;
  description?: string;
  station?: string;
  channel?: string;
  status: ProjectStatus;
  fileCount: number;
  createdAt: string;
  updatedAt: string;
  lastProcessedAt?: string;
}

export type UploadStatus = "pending" | "uploading" | "extracting" | "ready" | "error";

export interface UploadRecord {
  id: string;
  projectId: string;
  fileName: string;
  sizeBytes: number;
  status: UploadStatus;
  progress: number; // 0..100
  createdAt: string;
  totalFiles?: number;
  mseedFiles?: number;
  ignoredFiles?: number;
}

export type MseedFileStatus = "pending" | "read" | "processed" | "error";

export interface MseedFile {
  id: string;
  projectId: string;
  uploadId: string;
  fileName: string;
  extension: string;
  sizeBytes: number | null;
  network: string;
  station: string;
  location: string;
  channel: string;
  starttimeUtc: string;
  endtimeUtc: string;
  durationS: number;
  samplingRateHz: number;
  npts: number;
  min?: number;
  max?: number;
  mean?: number;
  std?: number;
  p99Abs?: number;
  peakAbs?: number;
  status: MseedFileStatus;
}

export interface ProcessingParameters {
  freqmin: number;
  freqmax: number;
  spikeZ: number;
  taperSeconds: number;
  sta: number;
  lta: number;
  triggerOn: number;
  triggerOff: number;
  steps: {
    despike: boolean;
    demean: boolean;
    detrend: boolean;
    taper: boolean;
    bandpass: boolean;
    psdWelch: boolean;
    spectrogram: boolean;
    staLta: boolean;
  };
}

export const DEFAULT_PARAMETERS: ProcessingParameters = {
  freqmin: 1.0,
  freqmax: 45.0,
  spikeZ: 20.0,
  taperSeconds: 30.0,
  sta: 0.5,
  lta: 5.0,
  triggerOn: 8.0,
  triggerOff: 2.0,
  steps: {
    despike: true,
    demean: true,
    detrend: true,
    taper: true,
    bandpass: true,
    psdWelch: true,
    spectrogram: true,
    staLta: true,
  },
};

export type ProcessingMode = "selected" | "batch" | "all";

export type ProcessingStep =
  | "upload"
  | "extract"
  | "read"
  | "qc"
  | "despike"
  | "preprocess"
  | "bandpass"
  | "psd"
  | "stalta"
  | "figures"
  | "export";

export const PROCESSING_STEPS: { key: ProcessingStep; label: string }[] = [
  { key: "upload", label: "Upload" },
  { key: "extract", label: "Extração" },
  { key: "read", label: "Leitura" },
  { key: "qc", label: "QC / Metadados" },
  { key: "despike", label: "Spikes" },
  { key: "preprocess", label: "Pré-processamento" },
  { key: "bandpass", label: "Filtro passa-banda" },
  { key: "psd", label: "PSD Welch" },
  { key: "stalta", label: "STA/LTA" },
  { key: "figures", label: "Gráficos" },
  { key: "export", label: "Exportação" },
];

export type JobStatus = "queued" | "running" | "paused" | "completed" | "canceled" | "error";

export interface ProcessingJob {
  id: string;
  projectId: string;
  status: JobStatus;
  mode: ProcessingMode;
  parameters: ProcessingParameters;
  progress: number; // 0..100
  currentStep: ProcessingStep;
  startedAt: string;
  finishedAt?: string;
  errorMessage?: string;
  fileIds: string[];
  stepProgress: Record<ProcessingStep, number>;
}

export type ResultType =
  | "summary_global"
  | "summary_per_file"
  | "gaps"
  | "spikes"
  | "psd_welch"
  | "band_energy"
  | "sta_lta_events"
  | "figure";

export interface ProcessingResult {
  id: string;
  projectId: string;
  jobId: string;
  resultType: ResultType;
  title: string;
  storagePath: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}
