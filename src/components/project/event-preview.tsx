import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatUtcMs } from "@/lib/format";

/** Seconds of signal shown before and after the event. */
const MARGIN_S = 5;

export interface PreviewEvent {
  eventId: number;
  startUtc: string;
  peakUtc: string;
  durationS: number;
  maxStaLta: number;
  snr: number | null;
  dominantFrequencyHz: number | null;
  qcFlags: string;
}

/** Filter of the processing run, so the preview shows the signal the detector analysed. */
export interface PreviewFilter {
  filterType: string;
  freqminHz: number | null;
  freqmaxHz: number | null;
  notchFreqsHz: number[];
  notchQ: number | null;
}

type Point = { t: number; v: number };

/** Query parameters of the timeseries route for the processing filter ("none" = raw signal). */
function filterQuery(filter: PreviewFilter): Record<string, string> {
  const query: Record<string, string> = {};
  if (filter.filterType !== "none") {
    query.filterType = filter.filterType;
    if (filter.freqminHz !== null) query.freqmin = String(filter.freqminHz);
    if (filter.freqmaxHz !== null) query.freqmax = String(filter.freqmaxHz);
  }
  if (filter.notchFreqsHz.length) {
    query.notchFreqs = filter.notchFreqsHz.join(",");
    query.notchQ = String(filter.notchQ ?? 30);
  }
  return query;
}

/**
 * Samples from `beforeS` before to `afterS` after `anchorUtc`, through the same timeseries
 * route as the Inspection tab. Times are returned in seconds relative to the anchor.
 */
function useWaveform(
  projectId: string,
  anchorUtc: string,
  beforeS: number,
  afterS: number,
  query: Record<string, string>,
) {
  const [points, setPoints] = useState<Point[]>([]);
  const [samplingRateHz, setSamplingRateHz] = useState<number | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  // Callers rebuild `query` on every render; a string key keeps the effect from refetching.
  const queryKey = JSON.stringify(query);

  useEffect(() => {
    const anchor = Date.parse(anchorUtc);
    const params = new URLSearchParams({
      start: new Date(anchor - beforeS * 1000).toISOString(),
      end: new Date(anchor + afterS * 1000).toISOString(),
      maxPoints: "1500",
      ...(JSON.parse(queryKey) as Record<string, string>),
    });
    const controller = new AbortController();
    setStatus("loading");
    fetch(`/api/timeseries/${projectId}?${params.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = (await response.json()) as {
          points?: Point[];
          startUtc?: string;
          samplingRateHz?: number;
          error?: string;
        };
        if (!response.ok) throw new Error(payload.error ?? "Falha ao carregar a forma de onda");
        // Points are relative to the first sample of the window; shift them to the anchor.
        const offset = payload.startUtc ? (Date.parse(payload.startUtc) - anchor) / 1000 : 0;
        setPoints((payload.points ?? []).map((p) => ({ t: p.t + offset, v: p.v })));
        setSamplingRateHz(payload.samplingRateHz ?? null);
        setStatus("ready");
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Falha ao carregar a forma de onda");
        setStatus("error");
      });
    return () => controller.abort();
  }, [projectId, anchorUtc, beforeS, afterS, queryKey]);

  return { points, samplingRateHz, status, error };
}

/**
 * Filtered waveform around one STA/LTA event (5 s before and after), with the triggered
 * interval shaded. Uses the same timeseries route as the Inspection tab.
 */
export function EventPreview({
  projectId,
  event,
  filter,
  onClose,
}: {
  projectId: string;
  event: PreviewEvent;
  filter: PreviewFilter;
  onClose: () => void;
}) {
  const { points, status, error } = useWaveform(
    projectId,
    event.startUtc,
    MARGIN_S,
    event.durationS + MARGIN_S,
    filterQuery(filter),
  );

  const peakS = (Date.parse(event.peakUtc) - Date.parse(event.startUtc)) / 1000;
  const flags = event.qcFlags.split(";").filter(Boolean);

  return (
    <div className="space-y-2 rounded-md border bg-muted/30 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-0.5 text-sm">
          <div className="font-medium">
            Evento {event.eventId} ·{" "}
            <span className="font-mono">{formatUtcMs(event.startUtc)}</span>
          </div>
          <div className="text-xs text-muted-foreground">
            duração {event.durationS.toFixed(2)} s · máx. STA/LTA {event.maxStaLta.toFixed(2)} · SNR{" "}
            {event.snr === null ? "—" : event.snr.toFixed(1)} · f dominante{" "}
            {event.dominantFrequencyHz === null
              ? "—"
              : `${event.dominantFrequencyHz.toFixed(1)} Hz`}
            {flags.length > 0 && ` · flags: ${flags.join(", ")}`}
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="Fechar evento">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <PreviewLegend
        items={[
          {
            kind: "area",
            color: "var(--color-chart-3)",
            label: "Evento: do disparo (STA/LTA ≥ trigger_on) até cair abaixo do trigger_off",
          },
          { kind: "dashed", color: "var(--color-chart-5)", label: "Instante do pico" },
          { kind: "line", color: "var(--color-primary)", label: "Sinal filtrado" },
        ]}
      />
      <div className="h-56">
        {status === "loading" && (
          <p className="py-20 text-center text-xs text-muted-foreground">
            Carregando a forma de onda…
          </p>
        )}
        {status === "error" && (
          <p className="py-20 text-center text-xs text-destructive">{error}</p>
        )}
        {status === "ready" && (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={points} margin={{ left: 12, right: 12, top: 4, bottom: 18 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <ReferenceArea
                x1={0}
                x2={event.durationS}
                fill="var(--color-chart-3)"
                fillOpacity={0.15}
                label={{
                  value: "evento",
                  position: "insideTop",
                  fontSize: 10,
                  fill: "var(--color-muted-foreground)",
                }}
              />
              <ReferenceLine x={peakS} stroke="var(--color-chart-5)" strokeDasharray="3 3" />
              <XAxis
                dataKey="t"
                type="number"
                domain={[-MARGIN_S, event.durationS + MARGIN_S]}
                ticks={wholeSecondTicks(-MARGIN_S, event.durationS + MARGIN_S)}
                tick={{ fontSize: 10 }}
                tickFormatter={(value: number) =>
                  value.toLocaleString(undefined, { maximumFractionDigits: 1 })
                }
                label={{
                  value: "Tempo relativo ao início do evento (s)",
                  position: "insideBottom",
                  offset: -12,
                  fontSize: 11,
                }}
              />
              <YAxis
                width={72}
                tick={{ fontSize: 10 }}
                tickFormatter={(value: number) =>
                  Math.abs(value) >= 100_000
                    ? value.toLocaleString(undefined, {
                        notation: "compact",
                        maximumFractionDigits: 1,
                      })
                    : value.toLocaleString(undefined, { maximumFractionDigits: 0 })
                }
                label={{
                  value: "Amplitude filtrada (contagens)",
                  angle: -90,
                  position: "insideLeft",
                  offset: 0,
                  fontSize: 11,
                  style: { textAnchor: "middle" },
                }}
              />
              <Tooltip
                contentStyle={{ fontSize: 12 }}
                labelFormatter={(value) =>
                  `${formatUtcMs(event.startUtc, Number(value))} (${Number(value).toFixed(2)} s)`
                }
                formatter={(v: number) => [
                  v.toLocaleString(undefined, { maximumFractionDigits: 1 }),
                  "Amplitude",
                ]}
              />
              <Line
                type="monotone"
                dataKey="v"
                stroke="var(--color-primary)"
                strokeWidth={1}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
      <p className="text-[10px] text-muted-foreground">
        Sinal com o mesmo filtro e notch do processamento.
      </p>
    </div>
  );
}

interface LegendItem {
  kind: "area" | "line" | "dashed";
  color: string;
  label: string;
}

/** Colour key for the preview charts (shaded interval, dashed marker, traces). */
function PreviewLegend({ items }: { items: LegendItem[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          {item.kind === "area" && (
            <span
              className="h-3 w-4 rounded-sm"
              style={{ backgroundColor: item.color, opacity: 0.3 }}
              aria-hidden="true"
            />
          )}
          {item.kind === "line" && (
            <span
              className="h-0.5 w-4"
              style={{ backgroundColor: item.color }}
              aria-hidden="true"
            />
          )}
          {item.kind === "dashed" && (
            <span
              className="w-4 border-t-2 border-dashed"
              style={{ borderColor: item.color }}
              aria-hidden="true"
            />
          )}
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/** Seconds of raw signal shown on each side of a spike (a spike is 1-3 samples long). */
const SPIKE_MARGIN_S = 1;

export interface PreviewSpike {
  spikeId: number;
  sample: number;
  timeUtc: string;
  rawAmplitude: number;
}

/**
 * Raw signal around a spike and the same signal after the spike is replaced by linear
 * interpolation (what the pipeline does). The glitch can be thousands of times larger than
 * the signal, so the vertical scale follows the cleaned trace and the raw spike leaves it.
 */
export function SpikePreview({
  projectId,
  spike,
  group,
  onClose,
}: {
  projectId: string;
  spike: PreviewSpike;
  /** Every sample of the spike's group (spikes of 2-3 contiguous samples). */
  group: PreviewSpike[];
  onClose: () => void;
}) {
  const { points, samplingRateHz, status, error } = useWaveform(
    projectId,
    spike.timeUtc,
    SPIKE_MARGIN_S,
    SPIKE_MARGIN_S,
    {},
  );
  const anchor = Date.parse(spike.timeUtc);
  const targetsKey = JSON.stringify(
    group.map((g) => ({ offset: (Date.parse(g.timeUtc) - anchor) / 1000, value: g.rawAmplitude })),
  );
  const series = useMemo(
    () => despike(points, JSON.parse(targetsKey) as SpikeTarget[], samplingRateHz),
    [points, targetsKey, samplingRateHz],
  );
  const offScale =
    status === "ready" &&
    (spike.rawAmplitude < series.domain[0] || spike.rawAmplitude > series.domain[1]);

  return (
    <div className="space-y-2 rounded-md border bg-muted/30 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-0.5 text-sm">
          <div className="font-medium">
            Spike grupo {spike.spikeId} ·{" "}
            <span className="font-mono">{formatUtcMs(spike.timeUtc)}</span>
          </div>
          <div className="text-xs text-muted-foreground">
            amostra {spike.sample.toLocaleString()} · amplitude bruta{" "}
            {spike.rawAmplitude.toLocaleString()} · {group.length} amostra(s) no grupo
            {offScale && " · o pico bruto sai da escala do gráfico"}
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="Fechar spike">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <PreviewLegend
        items={[
          { kind: "line", color: "var(--color-muted-foreground)", label: "Bruto (com o spike)" },
          {
            kind: "line",
            color: "var(--color-primary)",
            label: "Sem o spike (trocado por uma reta, como no processamento)",
          },
          { kind: "dashed", color: "var(--color-chart-5)", label: "Instante do spike" },
        ]}
      />
      <div className="h-56">
        {status === "loading" && (
          <p className="py-20 text-center text-xs text-muted-foreground">
            Carregando a forma de onda…
          </p>
        )}
        {status === "error" && (
          <p className="py-20 text-center text-xs text-destructive">{error}</p>
        )}
        {status === "ready" && (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series.rows} margin={{ left: 12, right: 12, top: 16, bottom: 18 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <ReferenceLine
                x={0}
                stroke="var(--color-chart-5)"
                strokeDasharray="3 3"
                label={{
                  value: "spike",
                  position: "top",
                  fontSize: 10,
                  fill: "var(--color-chart-5)",
                }}
              />
              <XAxis
                dataKey="t"
                type="number"
                domain={[-SPIKE_MARGIN_S, SPIKE_MARGIN_S]}
                ticks={[-1, -0.5, 0, 0.5, 1]}
                tick={{ fontSize: 10 }}
                tickFormatter={(value: number) =>
                  value.toLocaleString(undefined, { maximumFractionDigits: 1 })
                }
                label={{
                  value: "Tempo relativo ao spike (s)",
                  position: "insideBottom",
                  offset: -12,
                  fontSize: 11,
                }}
              />
              <YAxis
                width={72}
                domain={series.domain}
                allowDataOverflow
                tick={{ fontSize: 10 }}
                tickFormatter={(value: number) =>
                  value.toLocaleString(undefined, { maximumFractionDigits: 0 })
                }
                label={{
                  value: "Amplitude bruta (contagens)",
                  angle: -90,
                  position: "insideLeft",
                  offset: 0,
                  fontSize: 11,
                  style: { textAnchor: "middle" },
                }}
              />
              <Tooltip
                contentStyle={{ fontSize: 12 }}
                labelFormatter={(value) =>
                  `${formatUtcMs(spike.timeUtc, Number(value))} (${Number(value).toFixed(3)} s)`
                }
                formatter={(v: number, name) => [
                  v.toLocaleString(undefined, { maximumFractionDigits: 1 }),
                  name,
                ]}
              />
              <Line
                name="Bruto"
                type="linear"
                dataKey="raw"
                stroke="var(--color-muted-foreground)"
                strokeWidth={1}
                dot={false}
                isAnimationActive={false}
              />
              <Line
                name="Sem o spike"
                type="linear"
                dataKey="clean"
                stroke="var(--color-primary)"
                strokeWidth={1.2}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
      <p className="text-[10px] text-muted-foreground">
        Sinal bruto, sem filtro. A escala segue o sinal sem o spike; o pico bruto pode sair dela.
      </p>
    </div>
  );
}

interface SpikeTarget {
  offset: number;
  value: number;
}

/**
 * Finds each spike sample (the sample within ±3 samples of its time whose value matches the
 * known raw amplitude: times alone can differ by half a sample between the file and the
 * processed grid) and replaces it by linear interpolation between the nearest unmarked
 * neighbours. The vertical domain follows the cleaned trace.
 */
function despike(points: Point[], targets: SpikeTarget[], samplingRateHz: number | null) {
  const window = samplingRateHz ? 3 / samplingRateHz : 0.012;
  const marked = new Set<number>();
  for (const target of targets) {
    let best = -1;
    for (let i = 0; i < points.length; i += 1) {
      if (Math.abs(points[i].t - target.offset) > window || marked.has(i)) continue;
      const closer =
        Math.abs(points[i].v - target.value) < Math.abs(points[best]?.v - target.value);
      if (best < 0 || closer) best = i;
    }
    if (best >= 0) marked.add(best);
  }

  const clean = points.map((p) => p.v);
  for (const i of marked) {
    let left = i - 1;
    while (left >= 0 && marked.has(left)) left -= 1;
    let right = i + 1;
    while (right < points.length && marked.has(right)) right += 1;
    if (left >= 0 && right < points.length) {
      const w = (points[i].t - points[left].t) / (points[right].t - points[left].t);
      clean[i] = points[left].v + w * (points[right].v - points[left].v);
    } else if (left >= 0) {
      clean[i] = points[left].v;
    } else if (right < points.length) {
      clean[i] = points[right].v;
    }
  }

  const finite = clean.filter(Number.isFinite);
  const low = finite.length ? Math.min(...finite) : -1;
  const high = finite.length ? Math.max(...finite) : 1;
  // Round limits (1, 2 or 5 × 10^k steps) so the axis ticks are round numbers too.
  const span = Math.max(high - low, 1) * 1.3;
  const power = 10 ** Math.floor(Math.log10(span / 4));
  const step = [1, 2, 5, 10].map((m) => m * power).find((c) => c >= span / 4) ?? span / 4;
  return {
    rows: points.map((p, i) => ({ t: p.t, raw: p.v, clean: clean[i] })),
    domain: [Math.floor(low / step) * step - step, Math.ceil(high / step) * step + step] as [
      number,
      number,
    ],
  };
}

/** Whole-second ticks (every 2 s on long windows) between `from` and `to`. */
function wholeSecondTicks(from: number, to: number) {
  const step = to - from > 14 ? 2 : 1;
  const ticks: number[] = [];
  for (let value = Math.ceil(from / step) * step; value <= to; value += step) ticks.push(value);
  return ticks;
}
