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
import type { MseedFile } from "@/services/types";
import { formatDuration } from "@/lib/format";
import { listFiles } from "@/services/files";

type Mode = "file" | "range" | "batchCount" | "batchWindow";

interface Props {
  projectId: string;
  selection: string[];
}

type TimePoint = { t: number; v: number };

export function InspectionTab({ projectId, selection }: Props) {
  const [mode, setMode] = useState<Mode>("file");
  const [files, setFiles] = useState<MseedFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [fileId, setFileId] = useState<string>("");
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  const [data, setData] = useState<TimePoint[]>([]);
  const readFiles = files.filter((f) => f.status !== "pending");
  const [batchSize, setBatchSize] = useState(4);
  const [windowMin, setWindowMin] = useState(15);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    fetch(`/api/files/${projectId}`)
      .then(async (response) => {
        const payload = (await response.json()) as { files?: MseedFile[]; error?: string };
        if (!response.ok) throw new Error(payload.error ?? "Falha ao carregar arquivos reais");
        return payload.files ?? [];
      })
      .then((realFiles) => {
        if (cancelled) return;
        setFiles(realFiles);
      })
      .catch(() => {
        if (!cancelled) setFiles(listFiles(projectId));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [projectId]);

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
      maxPoints: "900",
    });

    fetch(`/api/timeseries/${projectId}?${params.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = (await response.json()) as { points?: TimePoint[]; error?: string };
        if (!response.ok) throw new Error(payload.error ?? "Falha ao carregar série temporal");
        setData(payload.points ?? []);
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setData([]);
      });

    return () => controller.abort();
  }, [projectId, timeseriesWindow]);

  const metrics = useMemo(
    () => computeMetrics(activeFiles, data, requestedRange),
    [activeFiles, data, requestedRange],
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
      </Card>

      <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-5">
        {metrics.map((m) => (
          <Card key={m.label}>
            <CardContent className="px-4 py-3">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {m.label}
              </div>
              <div className="mt-1 font-mono text-sm font-semibold">{m.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Série temporal</CardTitle>
        </CardHeader>
        <CardContent className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ left: 8, right: 8, top: 4, bottom: 4 }}>
              <defs>
                <linearGradient id="gTs" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="t" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v: number) => v.toFixed(3)} />
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

  return [
    { label: "Arquivos", value: files.length.toLocaleString() },
    { label: "Duração", value: formatDuration(durationS || files[0]?.durationS || 0) },
    { label: "Hz", value: samplingRates.length === 1 ? samplingRates[0].toString() : "misto" },
    { label: "N pontos", value: totalNpts.toLocaleString() },
    {
      label: "Mín / Máx",
      value: `${formatMetric(realMin.length ? Math.min(...realMin) : fallbackMin)} / ${formatMetric(
        realMax.length ? Math.max(...realMax) : fallbackMax,
      )}`,
    },
    { label: "Média", value: formatMetric(Number.isFinite(mean) ? mean : fallbackMean) },
    { label: "Desvio padrão", value: formatMetric(Number.isFinite(std) ? std : fallbackStd) },
    { label: "p99 |x|", value: formatMetric(realP99.length ? Math.max(...realP99) : fallbackP99) },
    {
      label: "Pico |x|",
      value: formatMetric(realPeak.length ? Math.max(...realPeak) : fallbackPeak),
    },
    { label: "Gaps", value: "0" },
  ];
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
