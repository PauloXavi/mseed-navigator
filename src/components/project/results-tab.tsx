import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Image, Sparkles } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { listJobs } from "@/services/processing";
import { formatDuration, formatUtc } from "@/lib/format";

interface Props {
  projectId: string;
}

type LoadStatus = "idle" | "loading" | "ready" | "error";

interface RealResults {
  global: {
    traceId: string;
    starttimeUtc: string;
    endtimeUtc: string;
    durationS: number;
    samplingRateHz: number;
    npts: number;
    min: number;
    max: number;
    mean: number;
    std: number;
    median: number;
    mad: number;
    p01: number;
    p99: number;
    numberOfGaps: number;
    spikesDetected: number;
    preprocessing: string;
    taperSeconds: number;
  };
  summary: SummaryRow[];
  overview: { minute: number; std: number; p99Abs: number; peakAbs: number }[];
  gaps: GapRow[];
  spikes: SpikeRow[];
  psd: {
    f: number;
    raw: number;
    processed: number;
    rawLog: number | null;
    processedLog: number | null;
  }[];
  bandEnergy: { band: string; energyRaw: number; energyProcessed: number }[];
  events: EventRow[];
  figures: { name: string; url: string }[];
}

interface SummaryRow {
  index: number;
  fileName: string;
  traceId: string;
  network: string;
  station: string;
  location: string;
  channel: string;
  starttimeUtc: string;
  endtimeUtc: string;
  durationS: number;
  samplingRateHz: number;
  npts: number;
  min: number;
  max: number;
  mean: number;
  std: number;
  p99Abs: number;
  peakAbs: number;
}

interface GapRow {
  network: string;
  station: string;
  location: string;
  channel: string;
  startUtc: string;
  endUtc: string;
  durationS: number;
  missingSamples: number;
}

interface SpikeRow {
  sample: number;
  timeUtc: string;
  secondsFromBeginning: number;
  hour: number;
  rawAmplitude: number;
  absAmplitude: number;
}

interface EventRow {
  eventId: number;
  sampleOn: number;
  sampleOff: number;
  startUtc: string;
  endUtc: string;
  startSecondsFromBeginning: number;
  startHour: number;
  durationS: number;
  maxStaLta: number;
  maxAbsAmplitudeFiltered: number;
  rmsFiltered: number;
}

export function ResultsTab({ projectId }: Props) {
  const jobs = useMemo(() => listJobs(projectId), [projectId]);
  const completed = jobs.find((j) => j.status === "completed");
  const [status, setStatus] = useState<LoadStatus>("idle");
  const [results, setResults] = useState<RealResults | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!completed) return;

    let cancelled = false;
    setStatus("loading");
    setError("");

    fetch(`/api/results/${projectId}`)
      .then(async (response) => {
        const payload = (await response.json()) as RealResults & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? "Falha ao carregar resultados");
        return payload;
      })
      .then((payload) => {
        if (cancelled) return;
        setResults(payload);
        setStatus("ready");
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Falha ao carregar resultados");
        setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [completed, projectId]);

  if (!completed) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-center">
          <Sparkles className="h-8 w-8 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Sem resultados ainda</h3>
          <p className="text-sm text-muted-foreground">
            Execute um processamento em <b>Processamento</b> para gerar tabelas e gráficos.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (status === "loading" || status === "idle") {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-center">
          <Sparkles className="h-8 w-8 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Carregando resultados reais</h3>
          <p className="text-sm text-muted-foreground">
            Lendo os CSVs e figuras gerados pelo backend Python.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (status === "error" || !results) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-center">
          <Sparkles className="h-8 w-8 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Não foi possível carregar os resultados</h3>
          <p className="text-sm text-muted-foreground">{error}</p>
        </CardContent>
      </Card>
    );
  }

  const bandEnergyChart = results.bandEnergy.map((row) => ({
    ...row,
    energyRawLog: log10(row.energyRaw),
    energyProcessedLog: log10(row.energyProcessed),
  }));

  return (
    <Tabs defaultValue="global" className="space-y-4">
      <TabsList className="flex-wrap">
        <TabsTrigger value="global">Resumo global</TabsTrigger>
        <TabsTrigger value="per-file">Por arquivo</TabsTrigger>
        <TabsTrigger value="gaps">Gaps</TabsTrigger>
        <TabsTrigger value="spikes">Spikes</TabsTrigger>
        <TabsTrigger value="psd">PSD Welch</TabsTrigger>
        <TabsTrigger value="bands">Energia por banda</TabsTrigger>
        <TabsTrigger value="events">Eventos STA/LTA</TabsTrigger>
        <TabsTrigger value="figures">Figuras</TabsTrigger>
      </TabsList>

      <TabsContent value="global" className="space-y-4">
        <div className="grid gap-3 md:grid-cols-5">
          <StatCard label="Arquivos processados" value={results.summary.length} />
          <StatCard label="Duração total" value={formatDuration(results.global.durationS)} />
          <StatCard label="Eventos STA/LTA" value={results.events.length} />
          <StatCard label="Spikes/anomalias" value={results.global.spikesDetected} />
          <StatCard label="Gaps encontrados" value={results.gaps.length} />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Resumo global do registro</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-4">
            <Metric label="Trace" value={results.global.traceId} />
            <Metric label="Início UTC" value={formatUtc(results.global.starttimeUtc)} />
            <Metric label="Fim UTC" value={formatUtc(results.global.endtimeUtc)} />
            <Metric label="Taxa amostral" value={`${results.global.samplingRateHz} Hz`} />
            <Metric label="Amostras" value={results.global.npts.toLocaleString()} />
            <Metric label="Média" value={formatNumber(results.global.mean)} />
            <Metric label="Desvio padrão" value={formatNumber(results.global.std)} />
            <Metric label="MAD" value={formatNumber(results.global.mad)} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Indicadores reais por arquivo/minuto</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={results.overview}>
                <defs>
                  <linearGradient id="stdG" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-chart-1)" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="var(--color-chart-1)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="minute" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip contentStyle={{ fontSize: 12 }} />
                <Area
                  type="monotone"
                  dataKey="std"
                  stroke="var(--color-chart-1)"
                  fill="url(#stdG)"
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="p99Abs"
                  stroke="var(--color-chart-3)"
                  dot={false}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="per-file">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Resumo por arquivo ({results.summary.length} registros)
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Arquivo</TableHead>
                  <TableHead>Início UTC</TableHead>
                  <TableHead>Duração</TableHead>
                  <TableHead>Std</TableHead>
                  <TableHead>p99 |x|</TableHead>
                  <TableHead>Pico |x|</TableHead>
                  <TableHead>N pontos</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.summary.slice(0, 80).map((row) => (
                  <TableRow key={row.fileName}>
                    <TableCell className="font-mono text-xs">{row.fileName}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {formatUtc(row.starttimeUtc)}
                    </TableCell>
                    <TableCell>{formatDuration(row.durationS)}</TableCell>
                    <TableCell className="font-mono">{formatNumber(row.std)}</TableCell>
                    <TableCell className="font-mono">{formatNumber(row.p99Abs)}</TableCell>
                    <TableCell className="font-mono">{formatNumber(row.peakAbs)}</TableCell>
                    <TableCell>{row.npts.toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="gaps">
        <Card>
          <CardContent className="p-0">
            {results.gaps.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                Nenhum gap detectado no CSV real gerado pelo pipeline.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Início</TableHead>
                    <TableHead>Fim</TableHead>
                    <TableHead>Duração</TableHead>
                    <TableHead>Amostras ausentes</TableHead>
                    <TableHead>Canal</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {results.gaps.map((gap, index) => (
                    <TableRow key={`${gap.startUtc}-${index}`}>
                      <TableCell className="font-mono text-xs">{formatUtc(gap.startUtc)}</TableCell>
                      <TableCell className="font-mono text-xs">{formatUtc(gap.endUtc)}</TableCell>
                      <TableCell>{formatDuration(gap.durationS)}</TableCell>
                      <TableCell>{gap.missingSamples.toLocaleString()}</TableCell>
                      <TableCell>{gap.channel}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="spikes" className="space-y-4">
        <div className="grid gap-3 md:grid-cols-3">
          <StatCard label="Spikes detectados" value={results.spikes.length} />
          <StatCard
            label="Maior amplitude bruta"
            value={formatNumber(Math.max(0, ...results.spikes.map((s) => s.absAmplitude)))}
          />
          <StatCard
            label="Limiar robusto"
            value={`z = ${results.global.spikesDetected ? 20 : 0}`}
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Spikes reais ao longo do tempo</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={results.spikes}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="hour" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip contentStyle={{ fontSize: 12 }} />
                <Line
                  dataKey="absAmplitude"
                  stroke="var(--color-chart-5)"
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tempo UTC</TableHead>
                  <TableHead>Hora</TableHead>
                  <TableHead>Amostra</TableHead>
                  <TableHead>Amplitude bruta</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.spikes.slice(0, 80).map((spike) => (
                  <TableRow key={`${spike.sample}-${spike.timeUtc}`}>
                    <TableCell className="font-mono text-xs">{formatUtc(spike.timeUtc)}</TableCell>
                    <TableCell className="font-mono">{spike.hour.toFixed(2)} h</TableCell>
                    <TableCell>{spike.sample.toLocaleString()}</TableCell>
                    <TableCell className="font-mono">{formatNumber(spike.rawAmplitude)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="psd">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">PSD Welch real — bruto vs processado</CardTitle>
          </CardHeader>
          <CardContent className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={results.psd}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis
                  dataKey="f"
                  tick={{ fontSize: 10 }}
                  label={{ value: "Hz", position: "insideBottom", offset: -2, fontSize: 10 }}
                />
                <YAxis
                  tick={{ fontSize: 10 }}
                  label={{
                    value: "log10 PSD",
                    angle: -90,
                    position: "insideLeft",
                    fontSize: 10,
                  }}
                />
                <Tooltip contentStyle={{ fontSize: 12 }} />
                <Line
                  dataKey="rawLog"
                  stroke="var(--color-chart-3)"
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  dataKey="processedLog"
                  stroke="var(--color-chart-1)"
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="bands">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Energia real por banda de frequência</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={bandEnergyChart}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="band" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip contentStyle={{ fontSize: 12 }} />
                <Bar dataKey="energyRawLog" fill="var(--color-chart-3)" radius={[4, 4, 0, 0]} />
                <Bar
                  dataKey="energyProcessedLog"
                  fill="var(--color-chart-2)"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="events" className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Eventos STA/LTA reais ao longo do tempo</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={results.events}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="startHour" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip contentStyle={{ fontSize: 12 }} />
                <ReferenceLine y={8} stroke="var(--color-warning)" strokeDasharray="3 3" />
                <ReferenceLine y={2} stroke="var(--color-muted-foreground)" strokeDasharray="3 3" />
                <Line
                  dataKey="maxStaLta"
                  stroke="var(--color-chart-1)"
                  dot
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Eventos candidatos STA/LTA ({results.events.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Início UTC</TableHead>
                  <TableHead>Duração</TableHead>
                  <TableHead>Máx. STA/LTA</TableHead>
                  <TableHead>Máx. amplitude filtrada</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.events.map((event, index) => (
                  <TableRow key={event.eventId}>
                    <TableCell>{event.eventId}</TableCell>
                    <TableCell className="font-mono text-xs">{formatUtc(event.startUtc)}</TableCell>
                    <TableCell>{formatDuration(event.durationS)}</TableCell>
                    <TableCell className="font-mono">{event.maxStaLta.toFixed(2)}</TableCell>
                    <TableCell className="font-mono">
                      {formatNumber(event.maxAbsAmplitudeFiltered)}
                    </TableCell>
                    <TableCell>
                      {index === 0 && <Badge variant="secondary">principal</Badge>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="figures">
        <div className="grid gap-3 md:grid-cols-2">
          {results.figures.map((figure) => (
            <FigureCard key={figure.name} name={figure.name} src={figure.url} />
          ))}
        </div>
      </TabsContent>
    </Tabs>
  );
}

function FigureCard({ name, src }: { name: string; src: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="font-mono text-xs">{name}</CardTitle>
      </CardHeader>
      <CardContent>
        {src ? (
          <img
            src={src}
            alt={name}
            className="aspect-video w-full rounded-md border bg-background object-contain"
          />
        ) : (
          <div className="flex aspect-video items-center justify-center rounded-md border border-dashed bg-muted/40 text-muted-foreground">
            <div className="flex flex-col items-center gap-1 px-4 text-center text-xs">
              <Image className="h-6 w-6" />
              Figura indisponível
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StatCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="px-4 py-3">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="mt-1 text-xl font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md border bg-card px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 truncate font-mono text-sm font-semibold">{value}</div>
    </div>
  );
}

function formatNumber(value: number) {
  return Number.isFinite(value)
    ? value.toLocaleString(undefined, { maximumFractionDigits: 3 })
    : "0";
}

function log10(value: number) {
  return value > 0 ? Math.log10(value) : null;
}
