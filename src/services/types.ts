// Domain types for miniSEED Studio.
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

export type SpikeMethod = "residual" | "global";
export type GapFillMethod = "interpolate" | "median";
export type StaLtaMethod = "classic" | "recursive";
export type FilterType = "bandpass" | "highpass" | "lowpass" | "bandstop";
export type FilterFamily = "butterworth" | "bessel";

// Mirrors the CLI options of backend/mseed_processing.py (see buildPipelineArgs).
export interface ProcessingParameters {
  filterType: FilterType;
  filterFamily: FilterFamily;
  freqmin: number;
  freqmax: number;
  filterOrder: number;
  zeroPhase: boolean;
  /** Removes isolated frequencies (e.g. 60 Hz mains hum) before the frequency filter. */
  notch: boolean;
  notchFreqs: number[];
  notchQ: number;
  spikeMethod: SpikeMethod;
  spikeZ: number;
  spikeWindow: number;
  spikeMaxWidth: number;
  taperSeconds: number;
  taperMaxFraction: number;
  gapFill: GapFillMethod;
  qcWindowSeconds: number;
  welchNperseg: number;
  staltaMethod: StaLtaMethod;
  sta: number;
  lta: number;
  triggerOn: number;
  triggerOff: number;
  maxEventSeconds: number;
  minEventSeconds: number;
  /** Marks events with SNR below `lowSnrThreshold` with the "low_snr" flag (kept in the table). */
  lowSnrFlag: boolean;
  lowSnrThreshold: number;
  /** Drops events with SNR below this value (0 = keep all). */
  minEventSnr: number;
  traceId: string;
  steps: {
    despike: boolean;
    demean: boolean;
    detrend: boolean;
    taper: boolean;
    /** Frequency filter on/off (name kept for saved jobs; the type is `filterType`). */
    bandpass: boolean;
    psdWelch: boolean;
    spectrogram: boolean;
    staLta: boolean;
  };
}

export const DEFAULT_PARAMETERS: ProcessingParameters = {
  filterType: "bandpass",
  filterFamily: "butterworth",
  freqmin: 1.0,
  freqmax: 45.0,
  filterOrder: 4,
  zeroPhase: true,
  notch: false,
  notchFreqs: [60],
  notchQ: 30,
  spikeMethod: "residual",
  spikeZ: 20.0,
  spikeWindow: 7,
  spikeMaxWidth: 3,
  taperSeconds: 30.0,
  taperMaxFraction: 0.05,
  gapFill: "interpolate",
  qcWindowSeconds: 60.0,
  welchNperseg: 8192,
  staltaMethod: "classic",
  sta: 0.5,
  lta: 5.0,
  triggerOn: 8.0,
  triggerOff: 2.0,
  maxEventSeconds: 5.0,
  minEventSeconds: 0.0,
  lowSnrFlag: false,
  lowSnrThreshold: 3.0,
  minEventSnr: 0.0,
  traceId: "",
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
  { key: "bandpass", label: "Filtragem" },
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
