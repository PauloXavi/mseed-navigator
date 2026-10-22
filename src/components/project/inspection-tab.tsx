import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { LineChart as LineIcon } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { HintLabel, InfoHint } from "@/components/info-hint";
import { useProjectFiles } from "@/hooks/use-project-files";
import type { GlossaryKey } from "@/lib/glossary";
import {
  FILTER_TYPES,
  filterUses,
  hasDecimalComma,
  parseFrequencyInput,
} from "@/services/parameters";
import type { FilterType, MseedFile } from "@/services/types";
import { formatDuration, formatUtcMs } from "@/lib/format";

const FILTER_TYPE_LABELS: Record<FilterType, string> = {
  bandpass: "Passa-banda",
  highpass: "Passa-alta",
  lowpass: "Passa-baixa",
  bandstop: "Rejeita-banda",
};

type Mode = "file" | "range" | "batchCount" | "batchWindow";

interface Props {
  projectId: string;
  selection: string[];
}

type TimePoint = { t: number; v: number };

interface TimeseriesInfo {
  traceId?: string;
  traceIds?: string[];
  gapCount?: number;
  filledSamples?: number;
  filtered?: boolean;
  notchSkipped?: number[];
  startUtc?: string;
  npts?: number;
  samplingRateHz?: number;
}

export function InspectionTab({ projectId, selection }: Props) {
  const [mode, setMode] = useState<Mode>("file");
  const { files, loading } = useProjectFiles(projectId);
  const [fileId, setFileId] = useState<string>("");
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  const [data, setData] = useState<TimePoint[]>([]);
  const [info, setInfo] = useState<TimeseriesInfo>({});
  const [loadError, setLoadError] = useState("");
  const readFiles = useMemo(() => files.filter((f) => f.status !== "pending"), [files]);
  const [batchSize, setBatchSize] = useState(4);
  const [windowMin, setWindowMin] = useState(15);
  const [traceId, setTraceId] = useState("");
  const [filterOn, setFilterOn] = useState(false);
  const [filterType, setFilterType] = useState<FilterType>("bandpass");
  const [freqmin, setFreqmin] = useState(1);
  const [freqmax, setFreqmax] = useState(45);
  const [notchText, setNotchText] = useState("");
  const [notchQ, setNotchQ] = useState(30);
  const liveFilter = useMemo(
    () => buildLiveFilter({ filterOn, filterType, freqmin, freqmax, notchText, notchQ }),
    [filterOn, filterType, freqmin, freqmax, notchText, notchQ],
  );

  const availableRange = useMemo(() => getAvailableRange(readFiles), [readFiles]);

  useEffect(() => {
    if (readFiles.length === 0) return;
    const selectedFile = selection.find((id) => readFiles.some((file) => file.id === id));
    const nextFileId = selectedFile ?? readFiles[0]?.id ?? "";
    setFileId((current) =>
      current && readFiles.some((file) => file.id === current) ? current : nextFileId,
    );
  }, [readFiles, selection]);

  useEffect(() => {
    if (!availableRange) return;
    setRangeStart((current) =>
      clampDateTimeLocal(current, availableRange.start, availableRange.end),
    );
    setRangeEnd((current) =>
      clampDateTimeLocal(current || availableRange.end, availableRange.start, availableRange.end),
    );
  }, [availableRange]);

  const activeFiles = useMemo(
    () =>
      getActiveFiles({
        mode,
        files: readFiles,
        fileId,
        rangeStart,
        rangeEnd,
        batchSize,
        windowMin,
      }),
    [batchSize, fileId, mode, rangeEnd, rangeStart, readFiles, windowMin],
  );
  const requestedRange = useMemo(
    () => getRequestedRange(mode, rangeStart, rangeEnd, activeFiles),
    [activeFiles, mode, rangeEnd, rangeStart],
  );
  const timeseriesWindow = useMemo(
    () => getTimeseriesWindow(mode, rangeStart, rangeEnd, activeFiles),
    [activeFiles, mode, rangeEnd, rangeStart],
  );

  useEffect(() => {
    if (!timeseriesWindow) {
      setData([]);
      return;
    }

    const controller = new AbortController();
    const params = new URLSearchParams({
      start: timeseriesWindow.start,
      end: timeseriesWindow.end,
      maxPoints: "1200",
    });
    if (traceId) params.set("traceId", traceId);
    for (const [key, value] of Object.entries(liveFilter.query)) params.set(key, value);

    fetch(`/api/timeseries/${projectId}?${params.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = (await response.json()) as TimeseriesInfo & {
          points?: TimePoint[];
          error?: string;
        };
        if (!response.ok) throw new Error(payload.error ?? "Falha ao carregar série temporal");
        setData(payload.points ?? []);
        setInfo(payload);
        setLoadError("");
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setData([]);
        setInfo({});
        setLoadError(error instanceof Error ? error.message : "Falha ao carregar série temporal");
      });

    return () => controller.abort();
  }, [projectId, timeseriesWindow, traceId, liveFilter.query]);

  // Time axis in s, min or h depending on the window, counted from the first sample.
  const chart = useMemo(() => {
    const durationS =
      info.npts && info.samplingRateHz
        ? (info.npts - 1) / info.samplingRateHz
        : (data[data.length - 1]?.t ?? 0);
    const scale = timeScale(durationS);
    return {
      ...scale,
      durationS,
      points: data.map((point) => ({ t: point.t / scale.divisor, v: point.v })),
    };
  }, [data, info.npts, info.samplingRateHz]);

  const metrics = useMemo(
    () => computeMetrics(activeFiles, data, requestedRange, info.gapCount),
    [activeFiles, data, requestedRange, info.gapCount],
  );

  if (loading) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-center">
          <LineIcon className="h-8 w-8 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Carregando janela real</h3>
          <p className="text-sm text-muted-foreground">
            Lendo o intervalo UTC dos arquivos MiniSEED.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (readFiles.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-center">
          <LineIcon className="h-8 w-8 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Nada para inspecionar</h3>
          <p className="text-sm text-muted-foreground">
            Vá para a aba <b>Arquivos</b>, selecione registros e clique em
            <b> Ler selecionados</b>.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Seleção de janela</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Modo</Label>
            <Select value={mode} onValueChange={(v) => setMode(v as Mode)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="file">Arquivo individual</SelectItem>
                <SelectItem value="range">Intervalo de tempo</SelectItem>
                <SelectItem value="batchCount">Lote por quantidade</SelectItem>
                <SelectItem value="batchWindow">Lote por janela</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {mode === "file" && (
            <div className="space-y-1.5 md:col-span-3">
              <Label className="text-xs">Arquivo</Label>
              <Select value={fileId} onValueChange={setFileId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {readFiles.map((f) => (
                    <SelectItem key={f.id} value={f.id} className="font-mono text-xs">
                      {f.fileName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {mode === "range" && (
            <>
              <div className="space-y-1.5">
                <Label className="text-xs">Início UTC</Label>
                <Input
                  type="datetime-local"
                  min={availableRange?.start}
                  max={availableRange?.end}
                  value={rangeStart}
                  onChange={(event) => setRangeStart(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Fim UTC</Label>
                <Input
                  type="datetime-local"
                  min={rangeStart || availableRange?.start}
                  max={availableRange?.end}
                  value={rangeEnd}
                  onChange={(event) => setRangeEnd(event.target.value)}
                />
              </div>
            </>
          )}
          {mode === "batchCount" && (
            <div className="space-y-1.5">
              <Label className="text-xs">Arquivos por lote</Label>
              <Input
                type="number"
                min={1}
                value={batchSize}
                onChange={(e) => setBatchSize(+e.target.value)}
              />
            </div>
          )}
          {mode === "batchWindow" && (
            <div className="space-y-1.5">
              <Label className="text-xs">Janela (minutos)</Label>
              <Input
                type="number"
                min={1}
                value={windowMin}
                onChange={(e) => setWindowMin(+e.target.value)}
              />
            </div>
          )}
        </CardContent>
        <CardContent className="grid gap-4 border-t pt-4 md:grid-cols-4">
          {(info.traceIds?.length ?? 0) > 1 && (
            <div className="space-y-1.5">
              <Label className="text-xs">Canal</Label>
              <Select value={info.traceId ?? ""} onValueChange={setTraceId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {info.traceIds?.map((id) => (
                    <SelectItem key={id} value={id} className="font-mono text-xs">
                      {id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
            <div>
              <HintLabel term="liveFilter" className="text-sm">
                Filtro ao vivo
              </HintLabel>
              <div className="text-xs text-muted-foreground">
                Filtro de frequência e notch só nesta janela; não altera os resultados
              </div>
            </div>
            <Switch aria-label="Filtro ao vivo" checked={filterOn} onCheckedChange={setFilterOn} />
          </div>
          {/* Always visible (disabled while off) so the filter options are discoverable.
              Not a <fieldset disabled>: that would also disable the (!) hints. */}
          <div
            role="group"
            aria-label="Opções do filtro ao vivo"
            className="grid gap-3 sm:grid-cols-2 md:col-span-3 md:grid-cols-[minmax(9.5rem,1.3fr)_repeat(4,minmax(0,1fr))]"
          >
            <div className="space-y-1.5">
              <div className="flex items-center gap-1">
                <Label className="text-xs">Tipo</Label>
                <InfoHint
                  term={filterType}
                  related={FILTER_TYPES.filter((type) => type !== filterType)}
                />
              </div>
              <Select
                value={filterType}
                onValueChange={(v) => setFilterType(v as FilterType)}
                disabled={!filterOn}
              >
                <SelectTrigger aria-label="Tipo do filtro ao vivo">
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
            </div>
            {filterUses(filterType).min && (
              <CompactNumber
                id="live-freqmin"
                label="freqmin (Hz)"
                term="freqmin"
                step={0.1}
                value={freqmin}
                onChange={setFreqmin}
                disabled={!filterOn}
              />
            )}
            {filterUses(filterType).max && (
              <CompactNumber
                id="live-freqmax"
                label="freqmax (Hz)"
                term="freqmax"
                step={0.1}
                value={freqmax}
                onChange={setFreqmax}
                disabled={!filterOn}
              />
            )}
            <div className="space-y-1.5">
              <div className="flex items-center gap-1">
                <Label htmlFor="live-notch" className="text-xs">
                  Notch (Hz)
                </Label>
                <InfoHint term="notch" />
              </div>
              <Input
                id="live-notch"
                placeholder="ex.: 60, 29"
                value={notchText}
                disabled={!filterOn}
                onChange={(e) => setNotchText(e.target.value)}
                className="font-mono"
              />
            </div>
            <CompactNumber
              id="live-notch-q"
              label="Q do notch"
              term="notchQ"
              step={1}
              value={notchQ}
              onChange={setNotchQ}
              disabled={!filterOn || !notchText.trim()}
            />
            {filterOn && liveFilter.error && (
              <p className="text-xs text-destructive sm:col-span-2 md:col-span-5">
                {liveFilter.error}
              </p>
            )}
            {(info.notchSkipped?.length ?? 0) > 0 && (
              <p className="text-xs text-muted-foreground sm:col-span-2 md:col-span-5">
                Notch ignorado em {info.notchSkipped?.join(", ")} Hz: acima do limite de Nyquist.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-5">
        {metrics.map((m) => (
          <Card key={m.label}>
            <CardContent className="px-4 py-3">
              <div className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                {m.label}
                {m.term && <InfoHint term={m.term} />}
              </div>
              <div className="mt-1 font-mono text-sm font-semibold">{m.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Série temporal{" "}
            {info.traceId && <span className="font-mono text-xs">· {info.traceId}</span>}
            {info.filtered && <span className="text-xs text-muted-foreground"> · filtrada</span>}
          </CardTitle>
          {loadError && <p className="text-xs text-destructive">{loadError}</p>}
        </CardHeader>
        <CardContent className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chart.points} margin={{ left: 12, right: 12, top: 4, bottom: 18 }}>
              <defs>
                <linearGradient id="gTs" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis
                dataKey="t"
                type="number"
                domain={[0, chart.durationS / chart.divisor]}
                ticks={roundTicks(chart.durationS / chart.divisor)}
                tick={{ fontSize: 10 }}
                tickFormatter={axisNumber}
                label={{
                  value: info.startUtc
                    ? `Tempo desde ${formatUtcMs(info.startUtc)} (${chart.unit})`
                    : `Tempo (${chart.unit})`,
                  position: "insideBottom",
                  offset: -12,
                  fontSize: 11,
                }}
              />
              <YAxis
                width={72}
                tick={{ fontSize: 10 }}
                tickFormatter={axisNumber}
                label={{
                  value: info.filtered ? "Amplitude filtrada (contagens)" : "Amplitude (contagens)",
                  angle: -90,
                  position: "insideLeft",
                  offset: 0,
                  fontSize: 11,
                  style: { textAnchor: "middle" },
                }}
              />
              <Tooltip
                contentStyle={{ fontSize: 12 }}
                // Full UTC time of the hovered sample, plus its offset on the axis.
                labelFormatter={(value) =>
                  `${formatUtcMs(info.startUtc, Number(value) * chart.divisor)} (${axisNumber(Number(value))} ${chart.unit})`
                }
                formatter={(v: number) => [
                  v.toLocaleString(undefined, { maximumFractionDigits: 3 }),
                  "Amplitude",
                ]}
              />
              <Area
                type="monotone"
                dataKey="v"
                stroke="var(--color-primary)"
                fill="url(#gTs)"
                strokeWidth={1.2}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}

function CompactNumber({
  id,
  label,
  term,
  step,
  value,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  term: GlossaryKey;
  step: number;
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1">
        <Label htmlFor={id} className="text-xs">
          {label}
        </Label>
        <InfoHint term={term} />
      </div>
      <Input
        id={id}
        type="number"
        step={step}
        value={Number.isFinite(value) ? value : ""}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value === "" ? Number.NaN : Number(e.target.value))}
      />
    </div>
  );
}

/** Query parameters of the live filter (empty when off or invalid) and a validation message. */
function buildLiveFilter({
  filterOn,
  filterType,
  freqmin,
  freqmax,
  notchText,
  notchQ,
}: {
  filterOn: boolean;
  filterType: FilterType;
  freqmin: number;
  freqmax: number;
  notchText: string;
  notchQ: number;
}): { query: Record<string, string>; error: string } {
  if (!filterOn) return { query: {}, error: "" };
  const uses = filterUses(filterType);
  if (uses.min && !(freqmin > 0)) return { query: {}, error: "freqmin deve ser positiva." };
  if (uses.max && !(freqmax > 0)) return { query: {}, error: "freqmax deve ser positiva." };
  if (uses.min && uses.max && freqmax <= freqmin)
    return { query: {}, error: "freqmax deve ser maior que freqmin." };

  const query: Record<string, string> = { filterType };
  if (uses.min) query.freqmin = String(freqmin);
  if (uses.max) query.freqmax = String(freqmax);
  if (notchText.trim()) {
    const freqs = parseFrequencyInput(notchText);
    if (hasDecimalComma(notchText))
      return {
        query: {},
        error: "Notch: use ponto nos decimais (59.5) e vírgula + espaço entre valores (60, 29).",
      };
    if (freqs.length === 0 || freqs.some((f) => !Number.isFinite(f) || f <= 0))
      return { query: {}, error: "Notch: use números positivos separados por vírgula e espaço." };
    if (!(notchQ > 0)) return { query: {}, error: "Q do notch deve ser positivo." };
    query.notchFreqs = freqs.join(",");
    query.notchQ = String(notchQ);
  }
  return { query, error: "" };
}

/** Same unit choice as the Results charts and the backend figures. */
function timeScale(durationS: number) {
  if (durationS <= 600) return { divisor: 1, unit: "s" };
  if (durationS <= 3 * 3600) return { divisor: 60, unit: "min" };
  return { divisor: 3600, unit: "h" };
}

/** Ticks at a round step (1, 1.5, 2, 2.5, 3 or 5 × 10^k) from 0 up to `max`, about 5 of them. */
function roundTicks(max: number) {
  if (!(max > 0)) return [0];
  const raw = max / 5;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step =
    [1, 1.5, 2, 2.5, 3, 5, 10].map((m) => m * power).find((candidate) => candidate >= raw) ?? raw;
  const ticks: number[] = [];
  for (let value = 0; value <= max + step * 1e-9; value += step) {
    ticks.push(Number(value.toFixed(10)));
  }
  return ticks;
}

/** Tick label: compact for large amplitudes ("-8 mi"), at most 2 decimals otherwise. */
function axisNumber(value: number) {
  if (!Number.isFinite(value)) return "";
  return Math.abs(value) >= 100_000
    ? value.toLocaleString(undefined, { notation: "compact", maximumFractionDigits: 1 })
    : value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function getAvailableRange(files: MseedFile[]) {
  const timestamps = files
    .flatMap((file) => [new Date(file.starttimeUtc).getTime(), new Date(file.endtimeUtc).getTime()])
    .filter(Number.isFinite);

  if (timestamps.length === 0) return null;

  return {
    start: toDateTimeLocalUtc(new Date(Math.min(...timestamps)).toISOString()),
    end: toDateTimeLocalUtc(new Date(Math.max(...timestamps)).toISOString()),
  };
}

function toDateTimeLocalUtc(iso: string) {
  return iso.replace("Z", "").slice(0, 16);
}

function clampDateTimeLocal(value: string, min: string, max: string) {
  if (!value) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function getActiveFiles({
  mode,
  files,
  fileId,
  rangeStart,
  rangeEnd,
  batchSize,
  windowMin,
}: {
  mode: Mode;
  files: MseedFile[];
  fileId: string;
  rangeStart: string;
  rangeEnd: string;
  batchSize: number;
  windowMin: number;
}) {
  if (files.length === 0) return [];

  const anchorIndex = Math.max(
    0,
    files.findIndex((file) => file.id === fileId),
  );
  const anchor = files[anchorIndex] ?? files[0];

  if (mode === "file") return anchor ? [anchor] : [];

  if (mode === "range") {
    const start = dateTimeLocalToUtcMs(rangeStart);
    const end = dateTimeLocalToUtcMs(rangeEnd);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
    return files.filter((file) => {
      const fileStart = Date.parse(file.starttimeUtc);
      const fileEnd = Date.parse(file.endtimeUtc);
      return fileStart < end && fileEnd > start;
    });
  }

  if (mode === "batchCount") {
    return files.slice(anchorIndex, anchorIndex + Math.max(1, batchSize));
  }

  const start = Date.parse(anchor.starttimeUtc);
  const end = start + Math.max(1, windowMin) * 60 * 1000;
  return files.filter((file) => {
    const fileStart = Date.parse(file.starttimeUtc);
    const fileEnd = Date.parse(file.endtimeUtc);
    return fileStart < end && fileEnd > start;
  });
}

function dateTimeLocalToUtcMs(value: string) {
  return value ? Date.parse(`${value}:00Z`) : Number.NaN;
}

function getRequestedRange(mode: Mode, rangeStart: string, rangeEnd: string, files: MseedFile[]) {
  if (mode !== "range") return null;
  const start = dateTimeLocalToUtcMs(rangeStart);
  const end = dateTimeLocalToUtcMs(rangeEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;

  const samplingRates = Array.from(new Set(files.map((file) => file.samplingRateHz)));
  const durationS = (end - start) / 1000;

  return {
    durationS,
    npts: samplingRates.length === 1 ? Math.round(durationS * samplingRates[0]) : null,
  };
}

function getTimeseriesWindow(mode: Mode, rangeStart: string, rangeEnd: string, files: MseedFile[]) {
  if (mode === "range") {
    const start = dateTimeLocalToUtcMs(rangeStart);
    const end = dateTimeLocalToUtcMs(rangeEnd);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
    return {
      start: `${rangeStart}:00Z`,
      end: `${rangeEnd}:00Z`,
    };
  }

  const starts = files.map((file) => Date.parse(file.starttimeUtc)).filter(Number.isFinite);
  const ends = files.map((file) => Date.parse(file.endtimeUtc)).filter(Number.isFinite);
  if (starts.length === 0 || ends.length === 0) return null;

  return {
    start: new Date(Math.min(...starts)).toISOString(),
    end: new Date(Math.max(...ends)).toISOString(),
  };
}

function computeMetrics(
  files: MseedFile[],
  data: TimePoint[],
  requestedRange: { durationS: number; npts: number | null } | null,
  gapCount: number | undefined,
) {
  const vs = data.map((d) => d.v);
  const fallbackMin = vs.length > 0 ? Math.min(...vs) : Number.NaN;
  const fallbackMax = vs.length > 0 ? Math.max(...vs) : Number.NaN;
  const fallbackMean = vs.length > 0 ? vs.reduce((a, b) => a + b, 0) / vs.length : Number.NaN;
  const fallbackStd =
    vs.length > 0
      ? Math.sqrt(vs.reduce((a, b) => a + (b - fallbackMean) ** 2, 0) / vs.length)
      : Number.NaN;
  const abs = vs.map((v) => Math.abs(v)).sort((a, b) => a - b);
  const fallbackP99 = abs[Math.floor(abs.length * 0.99)];
  const fallbackPeak = abs[abs.length - 1];
  const totalNpts = requestedRange?.npts ?? files.reduce((total, file) => total + file.npts, 0);
  const mean = weightedMean(files);
  const start = Math.min(
    ...files.map((file) => Date.parse(file.starttimeUtc)).filter(Number.isFinite),
  );
  const end = Math.max(...files.map((file) => Date.parse(file.endtimeUtc)).filter(Number.isFinite));
  const durationS =
    requestedRange?.durationS ??
    (Number.isFinite(start) && Number.isFinite(end) ? (end - start) / 1000 : 0);
  const samplingRates = Array.from(new Set(files.map((file) => file.samplingRateHz)));
  const realMin = finiteValues(files.map((file) => file.min));
  const realMax = finiteValues(files.map((file) => file.max));
  const realP99 = finiteValues(files.map((file) => file.p99Abs));
  const realPeak = finiteValues(files.map((file) => file.peakAbs));
  const std = combinedStd(files, mean);

  const metrics: { label: string; value: string; term?: GlossaryKey }[] = [
    { label: "Arquivos", value: files.length.toLocaleString(), term: "miniseed" },
    { label: "Duração", value: formatDuration(durationS || files[0]?.durationS || 0) },
    {
      label: "Hz",
      value: samplingRates.length === 1 ? samplingRates[0].toString() : "misto",
      term: "samplingRate",
    },
    { label: "N pontos", value: totalNpts.toLocaleString(), term: "npts" },
    {
      label: "Mín / Máx",
      value: `${formatMetric(realMin.length ? Math.min(...realMin) : fallbackMin)} / ${formatMetric(
        realMax.length ? Math.max(...realMax) : fallbackMax,
      )}`,
    },
    {
      label: "Média",
      value: formatMetric(Number.isFinite(mean) ? mean : fallbackMean),
      term: "mean",
    },
    {
      label: "Desvio padrão",
      value: formatMetric(Number.isFinite(std) ? std : fallbackStd),
      term: "std",
    },
    {
      label: "p99 |x|",
      value: formatMetric(realP99.length ? Math.max(...realP99) : fallbackP99),
      term: "p99",
    },
    {
      label: "Pico |x|",
      value: formatMetric(realPeak.length ? Math.max(...realPeak) : fallbackPeak),
      term: "peak",
    },
    {
      label: "Gaps",
      value: gapCount === undefined ? "—" : gapCount.toLocaleString(),
      term: "gaps",
    },
  ];
  return metrics;
}

function weightedMean(files: MseedFile[]) {
  const totalNpts = files.reduce((total, file) => total + file.npts, 0);
  if (totalNpts <= 0) return Number.NaN;
  return files.reduce((total, file) => total + (file.mean ?? 0) * file.npts, 0) / totalNpts;
}

function combinedStd(files: MseedFile[], mean: number) {
  const totalNpts = files.reduce((total, file) => total + file.npts, 0);
  if (totalNpts <= 0 || !Number.isFinite(mean)) return Number.NaN;

  const variance =
    files.reduce((total, file) => {
      const fileMean = file.mean ?? mean;
      const fileStd = file.std ?? 0;
      return total + file.npts * (fileStd ** 2 + (fileMean - mean) ** 2);
    }, 0) / totalNpts;

  return Math.sqrt(variance);
}

function finiteValues(values: Array<number | undefined>) {
  return values.filter((value): value is number => Number.isFinite(value));
}

function formatMetric(value: number) {
  return Number.isFinite(value) ? value.toFixed(3) : "—";
}
