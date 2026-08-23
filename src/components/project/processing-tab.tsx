import { useEffect, useMemo, useState } from "react";
import { Pause, Play, Square, StepForward, Zap } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { JobStatusBadge } from "@/components/status-badges";
import {
  cancelProcessingJob,
  getActiveJob,
  getProcessingProgress,
  pauseProcessingJob,
  resumeProcessingJob,
  startProcessingJob,
} from "@/services/processing";
import { listFiles } from "@/services/files";
import { DEFAULT_PARAMETERS, PROCESSING_STEPS } from "@/services/types";
import type { ProcessingJob, ProcessingParameters } from "@/services/types";

interface Props {
  projectId: string;
  selection: string[];
}

const PARAM_FIELDS: {
  key: keyof Omit<ProcessingParameters, "steps">;
  label: string;
  step: number;
  unit: string;
}[] = [
  { key: "freqmin", label: "freqmin", step: 0.1, unit: "Hz" },
  { key: "freqmax", label: "freqmax", step: 0.1, unit: "Hz" },
  { key: "spikeZ", label: "spike_z", step: 0.5, unit: "" },
  { key: "taperSeconds", label: "taper", step: 1, unit: "s" },
  { key: "sta", label: "STA", step: 0.1, unit: "s" },
  { key: "lta", label: "LTA", step: 0.1, unit: "s" },
  { key: "triggerOn", label: "trigger_on", step: 0.1, unit: "" },
  { key: "triggerOff", label: "trigger_off", step: 0.1, unit: "" },
];

const STEP_LABELS: { key: keyof ProcessingParameters["steps"]; label: string }[] = [
  { key: "despike", label: "Detectar/remover spikes" },
  { key: "demean", label: "Remover média" },
  { key: "detrend", label: "Detrend linear" },
  { key: "taper", label: "Taper cosseno" },
  { key: "bandpass", label: "Filtro passa-banda" },
  { key: "psdWelch", label: "PSD Welch" },
  { key: "spectrogram", label: "Espectrograma" },
  { key: "staLta", label: "Detecção STA/LTA" },
];

export function ProcessingTab({ projectId, selection }: Props) {
  const [params, setParams] = useState<ProcessingParameters>(DEFAULT_PARAMETERS);
  const [job, setJob] = useState<ProcessingJob | undefined>(() => getActiveJob(projectId));

  useEffect(() => {
    if (!job) return;
    const t = setInterval(() => {
      const j = getProcessingProgress(job.id);
      if (j) setJob({ ...j });
      if (j && (j.status === "completed" || j.status === "canceled" || j.status === "error")) {
        clearInterval(t);
      }
    }, 400);
    return () => clearInterval(t);
  }, [job?.id]);

  const files = useMemo(() => listFiles(projectId), [projectId]);
  const targetIds = selection.length ? selection : files.map((f) => f.id);

  function start(mode: "selected" | "batch" | "all") {
    const ids =
      mode === "all"
        ? files.map((f) => f.id)
        : mode === "batch"
          ? files.slice(0, 8).map((f) => f.id)
          : targetIds;
    const j = startProcessingJob({ projectId, mode, fileIds: ids, parameters: params });
    setJob(j);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <div className="space-y-4">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="text-base">Parâmetros de processamento</CardTitle>
              <CardDescription>
                Valores padrão do pipeline. Ajuste conforme a campanha.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
            {PARAM_FIELDS.map((f) => (
              <div key={f.key} className="space-y-1.5">
                <Label htmlFor={f.key} className="text-xs">
                  {f.label} {f.unit && <span className="text-muted-foreground">({f.unit})</span>}
                </Label>
                <Input
                  id={f.key}
                  type="number"
                  step={f.step}
                  value={params[f.key]}
                  onChange={(e) =>
                    setParams({ ...params, [f.key]: parseFloat(e.target.value) || 0 })
                  }
                  className="font-mono"
                />
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Etapas ativas</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {STEP_LABELS.map((s) => (
              <div
                key={s.key}
                className="flex items-center justify-between rounded-md border bg-card px-3 py-2"
              >
                <span className="text-sm">{s.label}</span>
                <Switch
                  checked={params.steps[s.key]}
                  onCheckedChange={(v) =>
                    setParams({ ...params, steps: { ...params.steps, [s.key]: v } })
                  }
                />
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Execução</CardTitle>
            {job && <JobStatusBadge status={job.status} />}
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => start("selected")}
                disabled={
                  targetIds.length === 0 || job?.status === "running" || job?.status === "paused"
                }
              >
                <Play className="mr-2 h-4 w-4" />
                Processar seleção ({targetIds.length})
              </Button>
              <Button
                variant="outline"
                onClick={() => start("batch")}
                disabled={files.length === 0 || job?.status === "running"}
              >
                <StepForward className="mr-2 h-4 w-4" />
                Próximo lote
              </Button>
              <Button
                variant="outline"
                onClick={() => start("all")}
                disabled={files.length === 0 || job?.status === "running"}
              >
                <Zap className="mr-2 h-4 w-4" />
                Processar tudo
              </Button>
              {job?.status === "running" && (
                <Button variant="outline" onClick={() => pauseProcessingJob(job.id)}>
                  <Pause className="mr-2 h-4 w-4" />
                  Pausar
                </Button>
              )}
              {job?.status === "paused" && (
                <Button variant="outline" onClick={() => resumeProcessingJob(job.id)}>
                  <Play className="mr-2 h-4 w-4" />
                  Retomar
                </Button>
              )}
              {job && (job.status === "running" || job.status === "paused") && (
                <Button variant="destructive" onClick={() => cancelProcessingJob(job.id)}>
                  <Square className="mr-2 h-4 w-4" />
                  Cancelar
                </Button>
              )}
            </div>

            {job && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-mono text-muted-foreground">
                    Progresso global · etapa atual: <b>{job.currentStep}</b>
                  </span>
                  <span className="font-mono">{job.progress}%</span>
                </div>
                <Progress value={job.progress} />
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Timeline do pipeline</CardTitle>
          <CardDescription>Estado de cada etapa do fluxo.</CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="space-y-2">
            {PROCESSING_STEPS.map((s, i) => {
              const p = job?.stepProgress[s.key] ?? 0;
              const active = job?.currentStep === s.key;
              const done = p >= 100;
              return (
                <li key={s.key} className="flex items-center gap-3">
                  <div
                    className={
                      "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold " +
                      (done
                        ? "border-success bg-success text-primary-foreground"
                        : active
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border bg-muted text-muted-foreground")
                    }
                  >
                    {i + 1}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className={active ? "font-medium" : ""}>{s.label}</span>
                      <span className="font-mono text-muted-foreground">{p}%</span>
                    </div>
                    <Progress value={p} className="h-1.5" />
                  </div>
                </li>
              );
            })}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
