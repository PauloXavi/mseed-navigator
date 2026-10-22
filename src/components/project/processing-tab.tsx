import { useEffect, useMemo, useState } from "react";
import { Play, Square, StepForward, Zap } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { HintLabel, InfoHint } from "@/components/info-hint";
import { cn } from "@/lib/utils";
import { JobStatusBadge } from "@/components/status-badges";
import { useProjectFiles } from "@/hooks/use-project-files";
import {
  cancelProcessingJob,
  getActiveJob,
  getLastParameters,
  refreshProcessingJob,
  startProcessingJob,
} from "@/services/processing";
import {
  FILTER_TYPES,
  filterUses,
  hasDecimalComma,
  parseFrequencyInput,
  validateParameters,
} from "@/services/parameters";
import type { GlossaryKey } from "@/lib/glossary";
import { DEFAULT_PARAMETERS, PROCESSING_STEPS } from "@/services/types";
import type {
  MseedFile,
  ProcessingJob,
  ProcessingMode,
  ProcessingParameters,
} from "@/services/types";

interface Props {
  projectId: string;
  selection: string[];
  /** Called whenever the job status changes (the page refreshes the project badge). */
  onJobChange?: () => void;
}

type NumericKey = {
  [K in keyof ProcessingParameters]: ProcessingParameters[K] extends number ? K : never;
}[keyof ProcessingParameters];

interface NumberField {
  key: NumericKey;
  label: string;
  step: number;
  /** Omit when another control of the same section already explains the term. */
  term?: GlossaryKey;
  /** Shown inside the box, so the label stays on one line. */
  unit?: string;
  hint?: string;
  /** (!) shown after the small hint text, for a term the hint mentions. */
  hintTerm?: GlossaryKey;
}

// One grid for every section: boxes keep the same width and line up across sections.
// Sized by the card (container query), not the window: next to the pipeline timeline the
// card is narrow, and 6 columns there would cut select labels and values.
const FIELD_GRID = "grid grid-cols-2 gap-x-3 gap-y-4 @lg:grid-cols-3 @4xl:grid-cols-6";

const SPIKE_FIELDS: NumberField[] = [
  { key: "spikeZ", label: "spike_z", step: 0.5, term: "spikeZ", hint: "z robusto (MAD)" },
  { key: "spikeWindow", label: "janela mediana", step: 2, term: "spikeWindow", unit: "amostras" },
  { key: "spikeMaxWidth", label: "largura máx.", step: 1, term: "spikeMaxWidth", unit: "amostras" },
];

const PREPROCESS_FIELDS: NumberField[] = [
  { key: "taperSeconds", label: "taper", step: 1, term: "taperSeconds", unit: "s" },
  {
    key: "taperMaxFraction",
    label: "taper máx.",
    step: 0.01,
    term: "taperMaxFraction",
    hint: "fração por borda",
  },
  { key: "qcWindowSeconds", label: "janela QC", step: 10, term: "qcWindow", unit: "s" },
  {
    key: "welchNperseg",
    label: "Welch nperseg",
    step: 256,
    term: "welchNperseg",
    unit: "amostras",
  },
];

const STALTA_FIELDS: NumberField[] = [
  { key: "sta", label: "STA", step: 0.1, term: "sta", unit: "s" },
  { key: "lta", label: "LTA", step: 0.1, term: "lta", unit: "s" },
  { key: "triggerOn", label: "trigger_on", step: 0.1, term: "triggerOn" },
  { key: "triggerOff", label: "trigger_off", step: 0.1, term: "triggerOff" },
  {
    key: "maxEventSeconds",
    label: "duração máx.",
    step: 0.5,
    term: "maxEventSeconds",
    unit: "s",
    hint: "0 = sem limite",
  },
];

const STEP_LABELS: {
  key: keyof ProcessingParameters["steps"];
  label: string;
  term: GlossaryKey;
}[] = [
  { key: "despike", label: "Detectar/remover spikes", term: "despike" },
  { key: "demean", label: "Remover média", term: "demean" },
  { key: "detrend", label: "Detrend linear", term: "detrend" },
  { key: "taper", label: "Taper cosseno", term: "taper" },
  { key: "bandpass", label: "Filtro de frequência", term: "frequencyFilter" },
  { key: "psdWelch", label: "PSD Welch", term: "psdWelch" },
  { key: "spectrogram", label: "Espectrograma", term: "spectrogram" },
  { key: "staLta", label: "Detecção STA/LTA", term: "staLta" },
];

const FILTER_TYPE_LABELS: Record<ProcessingParameters["filterType"], string> = {
  bandpass: "Passa-banda",
  highpass: "Passa-alta",
  lowpass: "Passa-baixa",
  bandstop: "Rejeita-banda",
};

const MAINS_HZ = 60;

const BATCH_SIZE = 8;

export function ProcessingTab({ projectId, selection, onJobChange }: Props) {
  const [params, setParams] = useState<ProcessingParameters>(() => getLastParameters(projectId));
  const [job, setJob] = useState<ProcessingJob | undefined>(() => getActiveJob(projectId));
  const [starting, setStarting] = useState(false);
  const { files } = useProjectFiles(projectId);
  const errors = useMemo(() => validateParameters(params), [params]);
  // Raw text of the notch list, so typing "60," does not get reformatted mid-edit.
  const [notchText, setNotchTextState] = useState(() => params.notchFreqs.join(", "));
  const uses = filterUses(params.filterType);
  const running = job?.status === "running" || starting;

  useEffect(() => {
    if (!job || job.status !== "running") return;
    const jobId = job.id;
    const timer = setInterval(() => {
      refreshProcessingJob(jobId)
        .then((updated) => {
          if (!updated) return;
          setJob(updated);
          if (updated.status !== "running") onJobChange?.();
          if (updated.status === "completed") {
            toast.success("Processamento concluído", {
              description: "Os resultados estão disponíveis na aba Resultados.",
            });
          } else if (updated.status === "error") {
            toast.error("Falha no processamento", { description: updated.errorMessage });
          }
        })
        .catch(() => undefined);
    }, 700);
    return () => clearInterval(timer);
  }, [job?.id, job?.status, onJobChange]);

  const selectedFiles = files.filter((f) => selection.includes(f.id));
  const targetFiles = selectedFiles.length ? selectedFiles : files;

  async function start(mode: ProcessingMode) {
    const chosen: MseedFile[] =
      mode === "all" ? files : mode === "batch" ? nextBatch(files) : targetFiles;
    setStarting(true);
    try {
      const j = await startProcessingJob({
        projectId,
        mode,
        fileIds: chosen.map((f) => f.id),
        // Empty list = every file in the data directory.
        fileNames: mode === "all" ? [] : chosen.map((f) => f.fileName),
        parameters: params,
      });
      setJob(j);
      onJobChange?.();
    } catch (err) {
      toast.error("Não foi possível iniciar", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setStarting(false);
    }
  }

  function setNumber(key: NumericKey, raw: string) {
    setParams({ ...params, [key]: raw === "" ? Number.NaN : Number(raw) });
  }

  function setNotchText(text: string) {
    setNotchTextState(text);
    setParams((current) => ({ ...current, notchFreqs: parseFrequencyInput(text) }));
  }

  function addMainsNotch() {
    const freqs = params.notchFreqs.includes(MAINS_HZ)
      ? params.notchFreqs
      : [MAINS_HZ, ...params.notchFreqs.filter(Number.isFinite)];
    setNotchTextState(freqs.join(", "));
    setParams({ ...params, notch: true, notchFreqs: freqs });
  }

  function resetParameters() {
    setParams(DEFAULT_PARAMETERS);
    setNotchTextState(DEFAULT_PARAMETERS.notchFreqs.join(", "));
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <div className="space-y-4">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="text-base">Parâmetros de processamento</CardTitle>
              <CardDescription>
                Enviados ao pipeline Python. Ajuste conforme a campanha e o tipo de sensor.
              </CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={resetParameters}>
              Restaurar padrão
            </Button>
          </CardHeader>
          <CardContent className="@container space-y-6">
            <section className="space-y-3">
              <SectionTitle term="frequencyFilter">Filtro de frequência</SectionTitle>
              <div className={FIELD_GRID}>
                <Field
                  label="Tipo"
                  term={params.filterType}
                  related={FILTER_TYPES.filter((type) => type !== params.filterType)}
                >
                  <Select
                    value={params.filterType}
                    onValueChange={(v) =>
                      setParams({ ...params, filterType: v as ProcessingParameters["filterType"] })
                    }
                  >
                    <SelectTrigger aria-label="Tipo do filtro">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FILTER_TYPES.map((type) => (
                        <SelectItem key={type} value={type}>
                          {FILTER_TYPE_LABELS[type]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <SelectField
                  label="Família"
                  term="filterFamily"
                  value={params.filterFamily}
                  onChange={(v) =>
                    setParams({
                      ...params,
                      filterFamily: v as ProcessingParameters["filterFamily"],
                    })
                  }
                  options={[
                    { value: "butterworth", label: "Butterworth" },
                    { value: "bessel", label: "Bessel" },
                  ]}
                />
                {uses.min && (
                  <NumberInput
                    field={{
                      key: "freqmin",
                      label: "freqmin",
                      step: 0.1,
                      term: "freqmin",
                      unit: "Hz",
                      hint:
                        params.filterType === "bandstop" ? "início da faixa removida" : undefined,
                    }}
                    value={params.freqmin}
                    onChange={setNumber}
                  />
                )}
                {uses.max && (
                  <NumberInput
                    field={{
                      key: "freqmax",
                      label: "freqmax",
                      step: 0.1,
                      term: "freqmax",
                      unit: "Hz",
                      hint:
                        params.filterType === "bandstop"
                          ? "fim da faixa removida"
                          : "máx. 95% de Nyquist",
                      hintTerm: params.filterType === "bandstop" ? undefined : "nyquist",
                    }}
                    value={params.freqmax}
                    onChange={setNumber}
                  />
                )}
                <NumberInput
                  field={{
                    key: "filterOrder",
                    label: "ordem",
                    step: 1,
                    term: "filterOrder",
                    hint: "por passagem",
                  }}
                  value={params.filterOrder}
                  onChange={setNumber}
                />
                <SwitchField
                  id="zeroPhase"
                  label="Fase zero"
                  term="zeroPhase"
                  checked={params.zeroPhase}
                  onChange={(v) => setParams({ ...params, zeroPhase: v })}
                  hint="desligue p/ filtro causal"
                />
              </div>
            </section>

            <section className="space-y-3">
              <SectionTitle term="notch">Notch (remover frequência específica)</SectionTitle>
              <div className={FIELD_GRID}>
                <SwitchField
                  id="notch"
                  label="Notch"
                  checked={params.notch}
                  onChange={(v) => setParams({ ...params, notch: v })}
                />
                <Field
                  label="Frequências (Hz)"
                  htmlFor="notchFreqs"
                  hint={
                    hasDecimalComma(notchText)
                      ? "use ponto nos decimais (59.5) e vírgula + espaço entre valores (60, 29)"
                      : "separadas por vírgula e espaço"
                  }
                  span={2}
                >
                  <Input
                    id="notchFreqs"
                    placeholder="ex.: 60, 29"
                    value={notchText}
                    disabled={!params.notch}
                    onChange={(e) => setNotchText(e.target.value)}
                    className="font-mono"
                  />
                </Field>
                <NumberInput
                  field={{ key: "notchQ", label: "Q", step: 1, term: "notchQ" }}
                  value={params.notchQ}
                  onChange={setNumber}
                  disabled={!params.notch}
                />
                <Field label="Atalho" span={2}>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9 w-full"
                    onClick={addMainsNotch}
                  >
                    60 Hz (rede elétrica)
                  </Button>
                </Field>
              </div>
            </section>

            <section className="space-y-3">
              <SectionTitle>Spikes</SectionTitle>
              <div className={FIELD_GRID}>
                <SelectField
                  label="Método de spike"
                  term="spikeMethod"
                  span={2}
                  value={params.spikeMethod}
                  onChange={(v) =>
                    setParams({ ...params, spikeMethod: v as ProcessingParameters["spikeMethod"] })
                  }
                  options={[
                    { value: "residual", label: "Resíduo de mediana + Hampel" },
                    { value: "global", label: "Global (legado)" },
                  ]}
                />
                {SPIKE_FIELDS.map((f) => (
                  <NumberInput key={f.key} field={f} value={params[f.key]} onChange={setNumber} />
                ))}
              </div>
            </section>

            <section className="space-y-3">
              <SectionTitle>Dados e pré-processamento</SectionTitle>
              <div className={FIELD_GRID}>
                <SelectField
                  label="Preencher gaps"
                  term="gapFill"
                  value={params.gapFill}
                  onChange={(v) =>
                    setParams({ ...params, gapFill: v as ProcessingParameters["gapFill"] })
                  }
                  options={[
                    { value: "interpolate", label: "Interpolação" },
                    { value: "median", label: "Mediana" },
                  ]}
                />
                {PREPROCESS_FIELDS.map((f) => (
                  <NumberInput key={f.key} field={f} value={params[f.key]} onChange={setNumber} />
                ))}
                <Field label="Trace id" term="traceId" htmlFor="traceId" hint="opcional">
                  <Input
                    id="traceId"
                    placeholder="NET.STA.LOC.CHA"
                    value={params.traceId}
                    onChange={(e) => setParams({ ...params, traceId: e.target.value.trim() })}
                    className="font-mono"
                  />
                </Field>
              </div>
            </section>

            <section className="space-y-3">
              <SectionTitle>STA/LTA</SectionTitle>
              <div className={FIELD_GRID}>
                <SelectField
                  label="Método"
                  term="staltaMethod"
                  value={params.staltaMethod}
                  onChange={(v) =>
                    setParams({
                      ...params,
                      staltaMethod: v as ProcessingParameters["staltaMethod"],
                    })
                  }
                  options={[
                    { value: "classic", label: "Clássico" },
                    { value: "recursive", label: "Recursivo" },
                  ]}
                />
                {STALTA_FIELDS.map((f) => (
                  <NumberInput key={f.key} field={f} value={params[f.key]} onChange={setNumber} />
                ))}
              </div>
            </section>

            <section className="space-y-3">
              <SectionTitle term="snr">Qualidade dos eventos</SectionTitle>
              <div className={FIELD_GRID}>
                <NumberInput
                  field={{
                    key: "minEventSeconds",
                    label: "duração mín.",
                    step: 0.1,
                    term: "minEventSeconds",
                    unit: "s",
                  }}
                  value={params.minEventSeconds}
                  onChange={setNumber}
                />
                <SwitchField
                  id="lowSnrFlag"
                  label="Flag low_snr"
                  term="lowSnr"
                  checked={params.lowSnrFlag}
                  onChange={(v) => setParams({ ...params, lowSnrFlag: v })}
                  hint="marca, não apaga"
                />
                <NumberInput
                  field={{
                    key: "lowSnrThreshold",
                    label: "limiar SNR",
                    step: 0.5,
                    hint: "abaixo disso: low_snr",
                  }}
                  value={params.lowSnrThreshold}
                  onChange={setNumber}
                  disabled={!params.lowSnrFlag}
                />
                <NumberInput
                  field={{
                    key: "minEventSnr",
                    label: "SNR mínimo",
                    step: 0.5,
                    term: "minEventSnr",
                    hint: "descarta; 0 = desligado",
                  }}
                  value={params.minEventSnr}
                  onChange={setNumber}
                />
              </div>
            </section>

            {errors.length > 0 && (
              <ul className="list-disc space-y-0.5 rounded-md border border-destructive/30 bg-destructive/5 px-6 py-2 text-xs text-destructive">
                {errors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            )}
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
                <HintLabel term={s.term} className="text-sm">
                  {s.label}
                </HintLabel>
                <Switch
                  aria-label={s.label}
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
                disabled={targetFiles.length === 0 || running || errors.length > 0}
              >
                <Play className="mr-2 h-4 w-4" />
                Processar seleção ({targetFiles.length})
              </Button>
              <Button
                variant="outline"
                onClick={() => start("batch")}
                disabled={files.length === 0 || running || errors.length > 0}
              >
                <StepForward className="mr-2 h-4 w-4" />
                Próximo lote ({Math.min(BATCH_SIZE, files.length)})
              </Button>
              <Button
                variant="outline"
                onClick={() => start("all")}
                disabled={files.length === 0 || running || errors.length > 0}
              >
                <Zap className="mr-2 h-4 w-4" />
                Processar tudo
              </Button>
              {job?.status === "running" && (
                <Button
                  variant="destructive"
                  onClick={async () => {
                    await cancelProcessingJob(job.id);
                    onJobChange?.();
                    setJob({ ...job, status: "canceled" });
                  }}
                >
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
                {job.status === "error" && job.errorMessage && (
                  <pre className="whitespace-pre-wrap rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
                    {job.errorMessage}
                  </pre>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Timeline do pipeline</CardTitle>
          <CardDescription>Etapa reportada pelo backend Python.</CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="space-y-2">
            {PROCESSING_STEPS.map((s, i) => {
              const p = job?.stepProgress[s.key] ?? 0;
              const active = job?.status === "running" && job.currentStep === s.key;
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

/** Next files not yet processed (falls back to the first batch). */
function nextBatch(files: MseedFile[]) {
  const pending = files.filter((f) => f.status !== "processed");
  return (pending.length ? pending : files).slice(0, BATCH_SIZE);
}

function SectionTitle({ term, children }: { term?: GlossaryKey; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1 border-b pb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
      {term && <InfoHint term={term} />}
    </div>
  );
}

/**
 * Grid cell: one-line label (+ hint), a 36 px control and an optional small note.
 * Every control has the same height, so the boxes of a row line up.
 */
function Field({
  label,
  term,
  related,
  htmlFor,
  hint,
  hintTerm,
  span,
  children,
}: {
  label: string;
  term?: GlossaryKey;
  /** Alternatives listed in the (!) popover (e.g. the other filter types). */
  related?: GlossaryKey[];
  htmlFor?: string;
  hint?: string;
  hintTerm?: GlossaryKey;
  span?: 2;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("min-w-0 space-y-1.5", span === 2 && "col-span-2")}>
      <div className="flex h-4 items-center gap-1">
        <Label htmlFor={htmlFor} className="truncate text-xs" title={label}>
          {label}
        </Label>
        {term && <InfoHint term={term} related={related} />}
      </div>
      {children}
      {hint && (
        <p className="flex items-center gap-1 text-[10px] leading-tight text-muted-foreground">
          <span className="truncate" title={hint}>
            {hint}
          </span>
          {hintTerm && <InfoHint term={hintTerm} />}
        </p>
      )}
    </div>
  );
}

function NumberInput({
  field,
  value,
  onChange,
  disabled,
}: {
  field: NumberField;
  value: number;
  onChange: (key: NumericKey, raw: string) => void;
  disabled?: boolean;
}) {
  return (
    <Field
      label={field.label}
      term={field.term}
      htmlFor={field.key}
      hint={field.hint}
      hintTerm={field.hintTerm}
    >
      <div className="relative">
        <Input
          id={field.key}
          type="number"
          step={field.step}
          value={Number.isFinite(value) ? value : ""}
          disabled={disabled}
          onChange={(e) => onChange(field.key, e.target.value)}
          className={cn(
            // No spinner arrows: they would sit on top of the unit (arrow keys still work).
            "font-mono [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
            field.unit && (field.unit.length > 2 ? "pr-[4.25rem]" : "pr-8"),
          )}
        />
        {field.unit && (
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">
            {field.unit}
          </span>
        )}
      </div>
    </Field>
  );
}

function SwitchField({
  id,
  label,
  term,
  checked,
  onChange,
  hint,
}: {
  id: string;
  label: string;
  term?: GlossaryKey;
  checked: boolean;
  onChange: (value: boolean) => void;
  hint?: string;
}) {
  return (
    <Field label={label} term={term} htmlFor={id} hint={hint}>
      <div className="flex h-9 items-center gap-2 rounded-md border bg-card px-3">
        <Switch id={id} aria-label={label} checked={checked} onCheckedChange={onChange} />
        <span className="text-sm">{checked ? "Ligado" : "Desligado"}</span>
      </div>
    </Field>
  );
}

function SelectField({
  label,
  term,
  value,
  onChange,
  options,
  span,
}: {
  label: string;
  term: GlossaryKey;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  span?: 2;
}) {
  return (
    <Field label={label} term={term} span={span}>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}
