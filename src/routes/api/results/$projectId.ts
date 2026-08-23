import { createFileRoute } from "@tanstack/react-router";

import { ensureProjectResults } from "@/server/backend-results";

export const Route = createFileRoute("/api/results/$projectId")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        try {
          const results = await ensureProjectResults(params.projectId);
          const payload = await readResultPayload(results);
          return Response.json(payload);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Falha ao carregar resultados";
          return Response.json({ error: message }, { status: 500 });
        }
      },
    },
  },
});

async function readResultPayload(results: Awaited<ReturnType<typeof ensureProjectResults>>) {
  const path = await import("node:path");

  const globalRows = await readCsv(path.join(results.tableDir, "resumo_global.csv"));
  const summaryRows = await readCsv(path.join(results.tableDir, "resumo_por_arquivo.csv"));
  const gapRows = await readCsv(path.join(results.tableDir, "gaps.csv"));
  const spikeRows = await readCsv(path.join(results.tableDir, "spikes_detectados.csv"));
  const psdRows = await readCsv(path.join(results.tableDir, "psd_welch.csv"));
  const bandRows = await readCsv(path.join(results.tableDir, "energia_por_banda.csv"));
  const eventRows = await readCsv(path.join(results.tableDir, "eventos_candidatos_sta_lta.csv"));

  const global = globalRows[0] ?? {};
  const summary = summaryRows.map((row, index) => ({
    index,
    fileName: text(row.arquivo),
    traceId: text(row.id),
    network: text(row.network),
    station: text(row.station),
    location: text(row.location),
    channel: text(row.channel),
    starttimeUtc: text(row.starttime_utc),
    endtimeUtc: text(row.endtime_utc),
    durationS: number(row.duration_s),
    samplingRateHz: number(row.sampling_rate_hz),
    npts: number(row.npts),
    min: number(row.min),
    max: number(row.max),
    mean: number(row.mean),
    std: number(row.std),
    p99Abs: number(row.p99_abs),
    peakAbs: number(row.peak_abs),
  }));

  const psd = downsample(psdRows, 900).map((row) => ({
    f: number(row.frequency_hz),
    raw: number(row.psd_raw),
    processed: number(row.psd_processed),
    rawLog: log10(number(row.psd_raw)),
    processedLog: log10(number(row.psd_processed)),
  }));

  return {
    global: {
      traceId: text(global.trace_id),
      starttimeUtc: text(global.starttime_utc),
      endtimeUtc: text(global.endtime_utc),
      durationS: number(global.duration_s),
      samplingRateHz: number(global.sampling_rate_hz),
      npts: number(global.npts),
      min: number(global.min),
      max: number(global.max),
      mean: number(global.mean),
      std: number(global.std),
      median: number(global.median),
      mad: number(global.mad),
      p01: number(global.p01),
      p99: number(global.p99),
      numberOfGaps: number(global.number_of_gaps),
      spikesDetected: number(global.spikes_detected),
      preprocessing: text(global.preprocessing),
      taperSeconds: number(global.taper_seconds),
    },
    summary,
    overview: summary.map((row, index) => ({
      minute: index,
      std: row.std,
      p99Abs: row.p99Abs,
      peakAbs: row.peakAbs,
    })),
    gaps: gapRows.map((row) => ({
      network: text(row.network),
      station: text(row.station),
      location: text(row.location),
      channel: text(row.channel),
      startUtc: text(row.gap_start),
      endUtc: text(row.gap_end),
      durationS: number(row.gap_duration_s),
      missingSamples: number(row.missing_samples),
    })),
    spikes: spikeRows.map((row) => ({
      sample: number(row.sample),
      timeUtc: text(row.time_utc),
      secondsFromBeginning: number(row.seconds_from_beginning),
      hour: number(row.seconds_from_beginning) / 3600,
      rawAmplitude: number(row.raw_amplitude),
      absAmplitude: Math.abs(number(row.raw_amplitude)),
    })),
    psd,
    bandEnergy: bandRows.map((row) => ({
      band: text(row.band_hz),
      energyRaw: number(row.energy_raw),
      energyProcessed: number(row.energy_processed),
    })),
    events: eventRows.map((row) => ({
      eventId: number(row.event_id),
      sampleOn: number(row.sample_on),
      sampleOff: number(row.sample_off),
      startUtc: text(row.starttime_utc),
      endUtc: text(row.endtime_utc),
      startSecondsFromBeginning: number(row.start_seconds_from_beginning),
      startHour: number(row.start_seconds_from_beginning) / 3600,
      durationS: number(row.duration_s),
      maxStaLta: number(row.max_sta_lta),
      maxAbsAmplitudeFiltered: number(row.max_abs_amplitude_filtered),
      rmsFiltered: number(row.rms_filtered),
    })),
    figures: results.figures,
  };
}

async function readCsv(filePath: string) {
  const fs = await import("node:fs/promises");
  const content = await fs.readFile(filePath, "utf8");
  const lines = content.trim().split(/\r?\n/);
  if (lines.length <= 1) return [];

  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

function parseCsvLine(line: string) {
  const values: string[] = [];
  let current = "";
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"' && quoted && next === '"') {
      current += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  values.push(current);
  return values;
}

function downsample<T>(rows: T[], maxPoints: number) {
  if (rows.length <= maxPoints) return rows;
  const step = Math.ceil(rows.length / maxPoints);
  return rows.filter((_, index) => index % step === 0);
}

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

function number(value: unknown) {
  const parsed = typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function log10(value: number) {
  return value > 0 ? Math.log10(value) : null;
}
