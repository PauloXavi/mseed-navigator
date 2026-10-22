import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle, Image, Sparkles } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Switch } from "@/components/ui/switch";
import { InfoHint } from "@/components/info-hint";
import { EventPreview, SpikePreview } from "@/components/project/event-preview";
import type { GlossaryKey } from "@/lib/glossary";
import { listJobs } from "@/services/processing";
import { formatDuration, formatUtc, formatUtcMs } from "@/lib/format";

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
    stdDespiked: number | null;
    psdRawSource: string;
    median: number;
    mad: number;
    p01: number;
    p99: number;
    numberOfGaps: number;
    numberOfOverlaps: number;
    filledSamples: number;
    gapFill: string;
    spikeMethod: string;
    spikeThresholdRobustZ: number;
    spikesDetected: number;
    spikeClusters: number;
    preprocessing: string;
    taperSeconds: number;
    filterType: string;
    filterFamily: string;
    freqminHz: number | null;
    freqmaxHz: number | null;
    filterOrder: number;
    notchFreqsHz: number[];
    notchQ: number | null;
    zeroPhase: boolean;
    staltaMethod: string;
    staS: number;
    ltaS: number;
    triggerOn: number;
    triggerOff: number;
    lowSnrThreshold: number | null;
    eventsLowSnr: number;
    minEventSnr: number;
    eventsDiscardedLowSnr: number;
  };
  summary: SummaryRow[];
  qcWindows: QcWindow[];
  gaps: GapRow[];
  spikes: SpikeRow[];
  psd: {
    f: number;
    raw: number;
    processed: number;
    rawLog: number | null;
    processedLog: number | null;
  }[];
  bandEnergy: {
    band: string;
    energyRaw: number;
    energyProcessed: number;
    percentRaw: number | null;
    percentProcessed: number | null;
  }[];
  events: EventRow[];
  run: {
    generatedAtUtc: string;
    runtimeS: number | null;
    software: Record<string, string>;
    files: string[];
    parameters: Record<string, unknown>;
    warnings: string[];
  };
  figures: { name: string; url: string }[];
}

interface SummaryRow {
  index: number;
  fileName: string;
  traceId: string;
  starttimeUtc: string;
  endtimeUtc: string;
  durationS: number;
  samplingRateHz: number;
  npts: number;
  std: number;
  p99Abs: number;
  peakAbs: number;
}

interface QcWindow {
  index: number;
  startUtc: string;
  secondsFromBeginning: number;
  durationS: number;
  std: number;
  p99AbsDev: number;
  peakAbsDev: number;
  rmsProcessed: number;
  spikeCount: number;
  filledFraction: number;
  flatline: boolean;
}

interface GapRow {
  channel: string;
  startUtc: string;
  endUtc: string;
  durationS: number;
  missingSamples: number;
  type: string;
}

interface SpikeRow {
  sample: number;
  timeUtc: string;
  secondsFromBeginning: number;
  rawAmplitude: number;
  absAmplitude: number;
  spikeId: number;
}

interface EventRow {
  eventId: number;
  startUtc: string;
  peakUtc: string;
  startSecondsFromBeginning: number;
  durationS: number;
  maxStaLta: number;
  maxAbsAmplitudeFiltered: number;
  rmsFiltered: number;
  snr: number | null;
  dominantFrequencyHz: number | null;
  qcFlags: string;
}

export function ResultsTab({ projectId }: Props) {
  const jobs = useMemo(() => listJobs(projectId), [projectId]);
  const completed = jobs.find((j) => j.status === "completed");
  const [status, setStatus] = useState<LoadStatus>("idle");
  const [results, setResults] = useState<RealResults | null>(null);
  const [error, setError] = useState("");
  const [hideLowSnr, setHideLowSnr] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);
  const eventsChartRef = useRef<HTMLDivElement>(null);
  const [selectedSpikeSample, setSelectedSpikeSample] = useState<number | null>(null);
  const spikesChartRef = useRef<HTMLDivElement>(null);

  // A new run renumbers events and spikes: a kept selection would point at another one.
  useEffect(() => {
    setSelectedEventId(null);
    setSelectedSpikeSample(null);
  }, [results]);

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
      <Placeholder
        title="Sem resultados ainda"
        text={
          <>
            Execute um processamento em <b>Processamento</b> para gerar tabelas e gráficos.
          </>
        }
      />
    );
  }

  if (status === "loading" || status === "idle") {
    return (
      <Placeholder
        title="Carregando resultados reais"
        text="Lendo os CSVs e figuras gerados pelo backend Python."
      />
    );
  }

  if (status === "error" || !results) {
    return <Placeholder title="Não foi possível carregar os resultados" text={error} />;
  }

  const time = timeScale(results.global.durationS);
  const { global } = results;
  const qcChart = results.qcWindows.map((row) => ({
    ...row,
    t: row.secondsFromBeginning / time.divisor,
  }));
  const spikeChart: SpikePoint[] = results.spikes.map((row) => ({
    t: row.secondsFromBeginning / time.divisor,
    amplitude: row.rawAmplitude,
    timeUtc: row.timeUtc,
    sample: row.sample,
    spikeId: row.spikeId,
  }));
  // The low-SNR filter only hides rows; the CSV and the counts keep every candidate.
  const visibleEvents = hideLowSnr
    ? results.events.filter((event) => !hasFlag(event, "low_snr"))
    : results.events;
  const principalId = results.events[0]?.eventId;
  const eventChart: EventPoint[] = visibleEvents.map((row) => ({
    t: row.startSecondsFromBeginning / time.divisor,
    staLta: row.maxStaLta,
    eventId: row.eventId,
    startUtc: row.startUtc,
    snr: row.snr,
  }));
  const gapCount = results.gaps.filter((gap) => gap.type === "gap").length;
  const rawLabel = global.psdRawSource === "despiked" ? "Bruto (sem spikes)" : "Bruto";
  const selectedPoint = eventChart.find((point) => point.eventId === selectedEventId) ?? null;
  const selectedEvent = results.events.find((event) => event.eventId === selectedEventId) ?? null;

  const selectedSpikePoint =
    spikeChart.find((point) => point.sample === selectedSpikeSample) ?? null;
  const selectedSpike =
    results.spikes.find((spike) => spike.sample === selectedSpikeSample) ?? null;
  const selectedSpikeGroup = selectedSpike
    ? results.spikes.filter((spike) => spike.spikeId === selectedSpike.spikeId)
    : [];

  /** Same as selectEvent, for the Spikes tab. */
  function selectSpike(sample: number, from: "table" | "chart") {
    const next = from === "table" && sample === selectedSpikeSample ? null : sample;
    setSelectedSpikeSample(next);
    if (next === null) return;
    requestAnimationFrame(() => {
      if (from === "table") {
        spikesChartRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      } else {
        document
          .getElementById(`spike-row-${sample}`)
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });
  }

  /** Table click: show the event in the chart above. Chart click: bring its row into view. */
  function selectEvent(eventId: number, from: "table" | "chart") {
    const next = from === "table" && eventId === selectedEventId ? null : eventId;
    setSelectedEventId(next);
    if (next === null) return;
    requestAnimationFrame(() => {
      if (from === "table") {
        eventsChartRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      } else {
        document
          .getElementById(`event-row-${eventId}`)
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });
  }

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
        <TabsTrigger value="params">Parâmetros</TabsTrigger>
      </TabsList>

      <TabsContent value="global" className="space-y-4">
        <div className="grid gap-3 md:grid-cols-5">
          <StatCard label="Arquivos processados" value={results.summary.length} />
          <StatCard label="Duração total" value={formatDuration(global.durationS)} />
          <StatCard
            label="Eventos STA/LTA"
            value={
              global.lowSnrThreshold === null
                ? results.events.length
                : `${results.events.length} (${global.eventsLowSnr} SNR baixo)`
            }
            term="staLtaEvents"
          />
          <StatCard
            label="Spikes (grupos)"
            value={`${global.spikesDetected} (${global.spikeClusters})`}
            term="spikeGroups"
          />
          <StatCard
            label="Gaps / overlaps"
            value={`${gapCount} / ${global.numberOfOverlaps}`}
            term="gapsOverlaps"
          />
        </div>

        {results.run.warnings.length > 0 && (
          <Card className="border-warning/40 bg-warning/5">
            <CardContent className="flex gap-3 px-4 py-3 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <ul className="space-y-0.5">
                {results.run.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Resumo global do registro</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-4">
            <Metric label="Trace" value={global.traceId} term="trace" />
            <Metric label="Início UTC" value={formatUtc(global.starttimeUtc)} />
            <Metric label="Fim UTC" value={formatUtc(global.endtimeUtc)} />
            <Metric
              label="Taxa amostral"
              value={`${global.samplingRateHz} Hz`}
              term="samplingRate"
            />
            <Metric label="Amostras" value={global.npts.toLocaleString()} />
            <Metric label="Média" value={formatNumber(global.mean)} />
            <Metric
              label="Desvio padrão"
              value={
                global.stdDespiked !== null && global.spikesDetected > 0
                  ? `${formatNumber(global.std)} (sem spikes: ${formatNumber(global.stdDespiked)})`
                  : formatNumber(global.std)
              }
              term="std"
            />
            <Metric label="MAD" value={formatNumber(global.mad)} term="mad" />
            <Metric label="Filtro" value={describeFilter(global)} term="frequencyFilter" />
            <Metric
              label="Notch"
              value={
                global.notchFreqsHz.length
                  ? `${global.notchFreqsHz.map(formatNumber).join(", ")} Hz · Q ${formatNumber(global.notchQ ?? Number.NaN)}`
                  : "desligado"
              }
              term="notch"
            />
            <Metric label="Pré-processamento" value={global.preprocessing} />
            <Metric
              label="Taper efetivo"
              value={`${formatNumber(global.taperSeconds)} s/borda`}
              term="effectiveTaper"
            />
            <Metric
              label="Amostras preenchidas"
              value={`${global.filledSamples.toLocaleString()} (${global.gapFill})`}
              term="filledSamples"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1 text-base">
              Indicadores de QC por janela <InfoHint term="qcWindows" />
            </CardTitle>
            <CardDescription>
              Amplitudes relativas à média de cada janela, em contagens <InfoHint term="counts" />.
              RMS <InfoHint term="rms" /> do sinal processado (na banda do filtro).
            </CardDescription>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={qcChart}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis
                  dataKey="t"
                  type="number"
                  domain={["dataMin", "dataMax"]}
                  tick={{ fontSize: 10 }}
                  tickFormatter={timeTick}
                  label={axisLabel(`tempo (${time.unit})`)}
                />
                <YAxis
                  width={64}
                  tick={{ fontSize: 10 }}
                  tickFormatter={compactNumber}
                  label={yAxisLabel("Amplitude (contagens)")}
                />
                <Tooltip
                  contentStyle={{ fontSize: 12 }}
                  formatter={tooltipNumber}
                  labelFormatter={(value) =>
                    `Janela de ${formatUtcMs(global.starttimeUtc, Number(value) * time.divisor)}`
                  }
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line
                  name="Desvio padrão"
                  dataKey="std"
                  stroke="var(--color-chart-1)"
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  name="p99 |x - média|"
                  dataKey="p99AbsDev"
                  stroke="var(--color-chart-3)"
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  name="RMS processado"
                  dataKey="rmsProcessed"
                  stroke="var(--color-chart-2)"
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
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
                  <HeadWithHint term="std">Std</HeadWithHint>
                  <HeadWithHint term="p99">p99 |x|</HeadWithHint>
                  <HeadWithHint term="peak">Pico |x|</HeadWithHint>
                  <HeadWithHint term="npts">N pontos</HeadWithHint>
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.summary.slice(0, 200).map((row) => (
                  <TableRow key={`${row.fileName}-${row.index}`}>
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
                Nenhum gap ou overlap detectado no CSV real gerado pelo pipeline.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Início</TableHead>
                    <TableHead>Fim</TableHead>
                    <TableHead>Duração</TableHead>
                    <HeadWithHint term="missingSamples">Amostras ausentes</HeadWithHint>
                    <TableHead>Canal</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {results.gaps.map((gap, index) => (
                    <TableRow key={`${gap.startUtc}-${index}`}>
                      <TableCell>
                        <Badge variant={gap.type === "gap" ? "secondary" : "outline"}>
                          {gap.type}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{formatUtc(gap.startUtc)}</TableCell>
                      <TableCell className="font-mono text-xs">{formatUtc(gap.endUtc)}</TableCell>
                      <TableCell>{formatDuration(Math.abs(gap.durationS))}</TableCell>
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
        <div className="grid gap-3 md:grid-cols-4">
          <StatCard label="Amostras marcadas" value={global.spikesDetected} />
          <StatCard label="Spikes (grupos)" value={global.spikeClusters} term="spikeGroups" />
          <StatCard
            label="Maior amplitude bruta"
            value={formatNumber(Math.max(0, ...results.spikes.map((s) => s.absAmplitude)))}
          />
          <StatCard
            label="Limiar robusto"
            term="robustThreshold"
            value={
              global.spikeMethod === "none"
                ? "desativado"
                : `z = ${global.spikeThresholdRobustZ} (${global.spikeMethod})`
            }
          />
        </div>

        <Card ref={spikesChartRef} className="scroll-mt-4">
          <CardHeader>
            <CardTitle className="text-base">Spikes ao longo do registro</CardTitle>
            <CardDescription>
              Clique em um spike (aqui ou na tabela) para ver o sinal ao redor dele, antes e depois
              da remoção.
            </CardDescription>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 18, right: 12, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis
                  dataKey="t"
                  type="number"
                  name={`tempo (${time.unit})`}
                  domain={[0, global.durationS / time.divisor]}
                  tick={{ fontSize: 10 }}
                  tickFormatter={timeTick}
                  label={axisLabel(`tempo (${time.unit})`)}
                />
                <YAxis
                  dataKey="amplitude"
                  type="number"
                  name="amplitude bruta"
                  width={64}
                  tick={{ fontSize: 10 }}
                  tickFormatter={compactNumber}
                  label={yAxisLabel("Amplitude bruta (contagens)")}
                />
                <Tooltip content={<SpikeTooltip />} />
                <Scatter
                  data={spikeChart}
                  fill="var(--color-chart-5)"
                  cursor="pointer"
                  isAnimationActive={false}
                  onClick={(point: { payload?: SpikePoint }) => {
                    if (point.payload) selectSpike(point.payload.sample, "chart");
                  }}
                />
                {selectedSpikePoint && (
                  <ReferenceLine
                    x={selectedSpikePoint.t}
                    stroke="var(--color-primary)"
                    strokeDasharray="4 2"
                    label={{
                      value: `Grupo ${selectedSpikePoint.spikeId}`,
                      position: "top",
                      fontSize: 10,
                      fill: "var(--color-primary)",
                    }}
                  />
                )}
                {selectedSpikePoint && (
                  <Scatter
                    data={[selectedSpikePoint]}
                    fill="var(--color-primary)"
                    shape={HighlightDot}
                    isAnimationActive={false}
                  />
                )}
              </ScatterChart>
            </ResponsiveContainer>
          </CardContent>
          {selectedSpike && (
            <CardContent>
              <SpikePreview
                projectId={projectId}
                spike={selectedSpike}
                group={selectedSpikeGroup}
                onClose={() => setSelectedSpikeSample(null)}
              />
            </CardContent>
          )}
        </Card>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Grupo</TableHead>
                  <TableHead>Tempo UTC</TableHead>
                  <TableHead>Desde o início</TableHead>
                  <TableHead>Amostra</TableHead>
                  <HeadWithHint term="counts">Amplitude bruta</HeadWithHint>
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.spikes.slice(0, 200).map((spike) => (
                  <TableRow
                    key={`${spike.sample}-${spike.timeUtc}`}
                    id={`spike-row-${spike.sample}`}
                    data-state={spike.sample === selectedSpikeSample ? "selected" : undefined}
                    aria-selected={spike.sample === selectedSpikeSample}
                    tabIndex={0}
                    className="cursor-pointer scroll-mt-24"
                    title="Mostrar este spike no gráfico acima"
                    onClick={() => selectSpike(spike.sample, "table")}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        selectSpike(spike.sample, "table");
                      }
                    }}
                  >
                    <TableCell>{spike.spikeId}</TableCell>
                    <TableCell className="font-mono text-xs">{formatUtc(spike.timeUtc)}</TableCell>
                    <TableCell className="font-mono">
                      {formatNumber(spike.secondsFromBeginning)} s
                    </TableCell>
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
            <CardTitle className="flex items-center gap-1 text-base">
              PSD Welch — bruto vs processado <InfoHint term="psdWelch" />
            </CardTitle>
            <CardDescription>
              log10 da PSD (contagens²/Hz), eixo de frequência logarítmico. Tracejado cinza: limites
              do filtro; roxo: notch.
            </CardDescription>
          </CardHeader>
          <CardContent className="h-80">
            {results.psd.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                Etapa PSD Welch desativada neste processamento.
              </p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={results.psd}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis
                    dataKey="f"
                    type="number"
                    scale="log"
                    domain={["dataMin", "dataMax"]}
                    tick={{ fontSize: 10 }}
                    tickFormatter={(value: number) => formatNumber(value)}
                    label={axisLabel("Hz")}
                  />
                  <YAxis
                    width={64}
                    tick={{ fontSize: 10 }}
                    label={yAxisLabel("log₁₀ PSD (contagens²/Hz)")}
                  />
                  <Tooltip contentStyle={{ fontSize: 12 }} formatter={tooltipNumber} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {global.freqminHz !== null && (
                    <ReferenceLine
                      x={global.freqminHz}
                      stroke="var(--color-muted-foreground)"
                      strokeDasharray="3 3"
                    />
                  )}
                  {global.freqmaxHz !== null && (
                    <ReferenceLine
                      x={global.freqmaxHz}
                      stroke="var(--color-muted-foreground)"
                      strokeDasharray="3 3"
                    />
                  )}
                  {global.notchFreqsHz.map((freq) => (
                    <ReferenceLine
                      key={freq}
                      x={freq}
                      stroke="var(--color-chart-4)"
                      strokeDasharray="4 2"
                    />
                  ))}
                  <Line
                    name={rawLabel}
                    dataKey="rawLog"
                    stroke="var(--color-chart-3)"
                    dot={false}
                    isAnimationActive={false}
                  />
                  <Line
                    name="Processado"
                    dataKey="processedLog"
                    stroke="var(--color-chart-1)"
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="bands">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1 text-base">
              Distribuição da potência por banda <InfoHint term="bandEnergy" />
            </CardTitle>
            <CardDescription>
              Percentual da potência total (integral da PSD) em cada banda, limitada ao Nyquist. As
              bandas não cobrem o espectro inteiro (ex.: abaixo de 0,1 Hz), então a soma pode ficar
              abaixo de 100%.
              {global.psdRawSource === "despiked" && " O bruto é calculado sem os spikes."}
            </CardDescription>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={results.bandEnergy}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="band" tick={{ fontSize: 11 }} label={axisLabel("Hz")} />
                <YAxis
                  width={64}
                  tick={{ fontSize: 10 }}
                  unit="%"
                  label={yAxisLabel("Potência (% do total)")}
                />
                <Tooltip contentStyle={{ fontSize: 12 }} formatter={tooltipNumber} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar
                  name={rawLabel}
                  dataKey="percentRaw"
                  fill="var(--color-chart-3)"
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  name="Processado"
                  dataKey="percentProcessed"
                  fill="var(--color-chart-2)"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="events" className="space-y-4">
        <Card ref={eventsChartRef} className="scroll-mt-4">
          <CardHeader>
            <CardTitle className="flex items-center gap-1 text-base">
              Eventos candidatos ao longo do registro <InfoHint term="staLta" />
            </CardTitle>
            <CardDescription>
              STA/LTA {global.staltaMethod} · STA {global.staS} s · LTA {global.ltaS} s · limiares{" "}
              {global.triggerOn} / {global.triggerOff}. Clique em um evento (aqui ou na tabela) para
              ver a forma de onda.
            </CardDescription>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 18, right: 12, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis
                  dataKey="t"
                  type="number"
                  name={`início (${time.unit})`}
                  domain={[0, global.durationS / time.divisor]}
                  tick={{ fontSize: 10 }}
                  tickFormatter={timeTick}
                  label={axisLabel(`tempo (${time.unit})`)}
                />
                <YAxis
                  dataKey="staLta"
                  type="number"
                  name="máx. STA/LTA"
                  width={64}
                  tick={{ fontSize: 10 }}
                  label={yAxisLabel("Máx. STA/LTA")}
                />
                <Tooltip content={<EventTooltip />} />
                <ReferenceLine
                  y={global.triggerOn}
                  stroke="var(--color-warning)"
                  strokeDasharray="3 3"
                />
                <ReferenceLine
                  y={global.triggerOff}
                  stroke="var(--color-muted-foreground)"
                  strokeDasharray="3 3"
                />
                <Scatter
                  data={eventChart}
                  fill="var(--color-chart-1)"
                  cursor="pointer"
                  isAnimationActive={false}
                  onClick={(point: { payload?: EventPoint }) => {
                    if (point.payload) selectEvent(point.payload.eventId, "chart");
                  }}
                />
                {selectedPoint && (
                  <ReferenceLine
                    x={selectedPoint.t}
                    stroke="var(--color-chart-5)"
                    strokeDasharray="4 2"
                    label={{
                      value: `Evento ${selectedPoint.eventId}`,
                      position: "top",
                      fontSize: 10,
                      fill: "var(--color-chart-5)",
                    }}
                  />
                )}
                {selectedPoint && (
                  <Scatter
                    data={[selectedPoint]}
                    fill="var(--color-chart-5)"
                    shape={HighlightDot}
                    isAnimationActive={false}
                  />
                )}
              </ScatterChart>
            </ResponsiveContainer>
          </CardContent>
          {selectedEvent && (
            <CardContent>
              <EventPreview
                projectId={projectId}
                event={selectedEvent}
                filter={{
                  filterType: global.filterType,
                  freqminHz: global.freqminHz,
                  freqmaxHz: global.freqmaxHz,
                  notchFreqsHz: global.notchFreqsHz,
                  notchQ: global.notchQ,
                }}
                onClose={() => setSelectedEventId(null)}
              />
            </CardContent>
          )}
        </Card>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1.5">
                <CardTitle className="flex items-center gap-1 text-base">
                  Eventos candidatos STA/LTA (
                  {hideLowSnr
                    ? `${visibleEvents.length} de ${results.events.length}`
                    : results.events.length}
                  ) <InfoHint term="staLtaEvents" />
                </CardTitle>
                <CardDescription>
                  Ordenados por máx. STA/LTA. SNR = RMS do evento / RMS da janela LTA anterior.
                  Flags: gap (janela toca amostras preenchidas), edge (região do taper), low_snr
                  (SNR abaixo do limiar).
                  {global.minEventSnr > 0 &&
                    ` ${global.eventsDiscardedLowSnr} candidato(s) descartado(s) por SNR < ${formatNumber(global.minEventSnr)}.`}
                </CardDescription>
              </div>
              <div className="flex items-center gap-2 rounded-md border bg-card px-3 py-2">
                <Switch
                  id="hide-low-snr"
                  checked={hideLowSnr}
                  disabled={global.eventsLowSnr === 0}
                  onCheckedChange={setHideLowSnr}
                />
                <div className="text-sm">
                  <label htmlFor="hide-low-snr">Esconder SNR baixo ({global.eventsLowSnr})</label>
                  <div className="text-xs text-muted-foreground">
                    {global.lowSnrThreshold === null
                      ? "Marcação desligada neste processamento"
                      : `Limiar: SNR < ${formatNumber(global.lowSnrThreshold)}`}
                  </div>
                </div>
                <InfoHint term="lowSnr" />
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Início UTC</TableHead>
                  <TableHead>Duração</TableHead>
                  <HeadWithHint term="maxStaLta">Máx. STA/LTA</HeadWithHint>
                  <HeadWithHint term="snr">SNR</HeadWithHint>
                  <HeadWithHint term="dominantFrequency">f dominante</HeadWithHint>
                  <HeadWithHint term="maxAmplitudeFiltered">Máx. |amplitude| filtrada</HeadWithHint>
                  <HeadWithHint term="flags">Flags</HeadWithHint>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleEvents.map((event) => (
                  <TableRow
                    key={event.eventId}
                    id={`event-row-${event.eventId}`}
                    data-state={event.eventId === selectedEventId ? "selected" : undefined}
                    aria-selected={event.eventId === selectedEventId}
                    tabIndex={0}
                    className="cursor-pointer scroll-mt-24"
                    title="Mostrar este evento no gráfico acima"
                    onClick={() => selectEvent(event.eventId, "table")}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        selectEvent(event.eventId, "table");
                      }
                    }}
                  >
                    <TableCell>{event.eventId}</TableCell>
                    <TableCell className="font-mono text-xs">{formatUtc(event.startUtc)}</TableCell>
                    <TableCell>{formatNumber(event.durationS)} s</TableCell>
                    <TableCell className="font-mono">{event.maxStaLta.toFixed(2)}</TableCell>
                    <TableCell className="font-mono">
                      {event.snr === null ? "—" : event.snr.toFixed(1)}
                    </TableCell>
                    <TableCell className="font-mono">
                      {event.dominantFrequencyHz === null
                        ? "—"
                        : `${event.dominantFrequencyHz.toFixed(1)} Hz`}
                    </TableCell>
                    <TableCell className="font-mono">
                      {formatNumber(event.maxAbsAmplitudeFiltered)}
                    </TableCell>
                    <TableCell>
                      {event.qcFlags
                        .split(";")
                        .filter(Boolean)
                        .map((flag) => (
                          <Badge key={flag} variant="outline" className="mr-1">
                            {flag}
                          </Badge>
                        ))}
                    </TableCell>
                    <TableCell>
                      {event.eventId === principalId && (
                        <Badge variant="secondary">principal</Badge>
                      )}
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

      <TabsContent value="params" className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Execução</CardTitle>
            <CardDescription>
              Registro completo em <code className="font-mono">parametros_processamento.json</code>{" "}
              (incluído nas exportações).
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-4">
            <Metric label="Gerado em (UTC)" value={formatUtc(results.run.generatedAtUtc)} />
            <Metric
              label="Tempo de execução"
              value={results.run.runtimeS === null ? "—" : `${results.run.runtimeS.toFixed(2)} s`}
            />
            <Metric label="Arquivos usados" value={results.run.files.length} />
            {Object.entries(results.run.software).map(([name, version]) => (
              <Metric key={name} label={name} value={version} />
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Parâmetros utilizados</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {Object.entries(results.run.parameters)
              .filter(([key]) => !["data_dir", "output_dir", "progress_file"].includes(key))
              .map(([key, value]) => (
                <Metric key={key} label={key} value={formatParameter(value)} />
              ))}
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}

function Placeholder({ title, text }: { title: string; text: React.ReactNode }) {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-center">
        <Sparkles className="h-8 w-8 text-muted-foreground" />
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-sm text-muted-foreground">{text}</p>
      </CardContent>
    </Card>
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
          <a href={src} target="_blank" rel="noreferrer">
            <img
              src={src}
              alt={name}
              className="aspect-video w-full rounded-md border bg-background object-contain"
            />
          </a>
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

function StatCard({
  label,
  value,
  term,
}: {
  label: string;
  value: React.ReactNode;
  term?: GlossaryKey;
}) {
  return (
    <Card>
      <CardContent className="px-4 py-3">
        <div className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">
          {label}
          {term && <InfoHint term={term} />}
        </div>
        <div className="mt-1 text-xl font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}

function Metric({
  label,
  value,
  term,
}: {
  label: string;
  value: React.ReactNode;
  term?: GlossaryKey;
}) {
  return (
    // min-w-0: a grid item does not shrink below its content otherwise, and `truncate` never kicks in.
    <div className="min-w-0 rounded-md border bg-card px-3 py-2">
      <div className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
        {term && <InfoHint term={term} />}
      </div>
      <div className="mt-0.5 truncate font-mono text-sm font-semibold">{value}</div>
    </div>
  );
}

interface SpikePoint {
  t: number;
  amplitude: number;
  timeUtc: string;
  sample: number;
  spikeId: number;
}

interface EventPoint {
  t: number;
  staLta: number;
  eventId: number;
  startUtc: string;
  snr: number | null;
}

/** Larger dot (in the Scatter's colour) for the selected event or spike. */
function HighlightDot(props: unknown) {
  const {
    cx = 0,
    cy = 0,
    fill = "var(--color-chart-5)",
  } = props as { cx?: number; cy?: number; fill?: string };
  return (
    <circle cx={cx} cy={cy} r={8} fill={fill} stroke="var(--color-background)" strokeWidth={2} />
  );
}

interface PointTooltipProps {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: unknown }>;
}

function TooltipBox({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <div className="rounded-md border bg-background px-3 py-2 text-xs shadow-sm">
      <div className="mb-1 font-mono font-medium">{title}</div>
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-4">
          <span className="text-muted-foreground">{label}</span>
          <span className="font-mono">{value}</span>
        </div>
      ))}
    </div>
  );
}

/** Hover card of a spike: full UTC time and raw amplitude. */
function SpikeTooltip({ active, payload }: PointTooltipProps) {
  const point = active ? (payload?.[0]?.payload as SpikePoint | undefined) : undefined;
  if (!point) return null;
  return (
    <TooltipBox
      title={formatUtcMs(point.timeUtc)}
      rows={[["Amplitude bruta", formatNumber(point.amplitude)]]}
    />
  );
}

/** Hover card of an event: full UTC start time, STA/LTA and SNR. */
function EventTooltip({ active, payload }: PointTooltipProps) {
  const point = active ? (payload?.[0]?.payload as EventPoint | undefined) : undefined;
  if (!point) return null;
  return (
    <TooltipBox
      title={formatUtcMs(point.startUtc)}
      rows={[
        ["Evento", String(point.eventId)],
        ["Máx. STA/LTA", point.staLta.toFixed(2)],
        ["SNR", point.snr === null ? "—" : point.snr.toFixed(1)],
      ]}
    />
  );
}

/** Column header with its (!) hint (one per column, not per row). */
function HeadWithHint({ term, children }: { term: GlossaryKey; children: React.ReactNode }) {
  return (
    <TableHead>
      <span className="inline-flex items-center gap-1">
        {children}
        <InfoHint term={term} />
      </span>
    </TableHead>
  );
}

const FILTER_TYPE_LABELS: Record<string, string> = {
  bandpass: "Passa-banda",
  highpass: "Passa-alta",
  lowpass: "Passa-baixa",
  bandstop: "Rejeita-banda",
};

function describeFilter(global: RealResults["global"]) {
  if (global.filterType === "none") return "desativado";
  const fmin = global.freqminHz;
  const fmax = global.freqmaxHz;
  const range =
    global.filterType === "highpass"
      ? `> ${formatNumber(fmin ?? Number.NaN)} Hz`
      : global.filterType === "lowpass"
        ? `< ${formatNumber(fmax ?? Number.NaN)} Hz`
        : `${formatNumber(fmin ?? Number.NaN)}–${formatNumber(fmax ?? Number.NaN)} Hz`;
  const family = global.filterFamily === "bessel" ? "Bessel" : "Butterworth";
  const phase = global.zeroPhase ? "fase zero" : "causal";
  return `${FILTER_TYPE_LABELS[global.filterType] ?? global.filterType} ${range} · ${family} ordem ${global.filterOrder} · ${phase}`;
}

/** Same unit choice as the backend figures. */
function timeScale(durationS: number) {
  if (durationS <= 600) return { divisor: 1, unit: "s" };
  if (durationS <= 3 * 3600) return { divisor: 60, unit: "min" };
  return { divisor: 3600, unit: "h" };
}

function axisLabel(value: string) {
  return { value, position: "insideBottom" as const, offset: -2, fontSize: 10 };
}

/** Vertical axis title, rotated and centred along the axis. */
function yAxisLabel(value: string) {
  return {
    value,
    angle: -90,
    position: "insideLeft" as const,
    offset: 4,
    fontSize: 10,
    style: { textAnchor: "middle" as const },
  };
}

function formatNumber(value: number) {
  return Number.isFinite(value)
    ? value.toLocaleString(undefined, { maximumFractionDigits: 3 })
    : "—";
}

function timeTick(value: number) {
  return Number.isFinite(value)
    ? value.toLocaleString(undefined, { maximumFractionDigits: 2 })
    : "";
}

function compactNumber(value: number) {
  return Number.isFinite(value)
    ? value.toLocaleString(undefined, { notation: "compact", maximumFractionDigits: 2 })
    : "";
}

function tooltipNumber(value: unknown) {
  return typeof value === "number" ? formatNumber(value) : String(value);
}

function hasFlag(event: EventRow, flag: string) {
  return event.qcFlags.split(";").includes(flag);
}

function formatParameter(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (Array.isArray(value)) {
    // Bands are stored as [[fmin, fmax], ...].
    return value
      .map((item) => (Array.isArray(item) ? item.join("–") : formatParameter(item)))
      .join(", ");
  }
  if (typeof value === "boolean") return value ? "sim" : "não";
  return String(value);
}
