import { createFileRoute } from "@tanstack/react-router";

import { PARAMS_FILE, ensureProjectResults, errorResponse } from "@/server/backend-results";
import { bool, nullableNumber, number, readCsv, text } from "@/server/csv";

export const Route = createFileRoute("/api/results/$projectId")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        try {
          const results = await ensureProjectResults(params.projectId);
          const payload = await readResultPayload(results);
          return Response.json(payload);
        } catch (error) {
          return errorResponse(error, "Falha ao carregar resultados");
        }
      },
    },
  },
});

async function readResultPayload(results: Awaited<ReturnType<typeof ensureProjectResults>>) {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const table = (name: string) => readCsv(path.join(results.tableDir, name));

  const [globalRows, summaryRows, gapRows, spikeRows, psdRows, bandRows, eventRows, qcRows] =
    await Promise.all([
      table("resumo_global.csv"),
      table("resumo_por_arquivo.csv"),
      table("gaps.csv"),
      table("spikes_detectados.csv"),
      table("psd_welch.csv"),
      table("energia_por_banda.csv"),
      table("eventos_candidatos_sta_lta.csv"),
      table("indicadores_por_janela.csv"),
    ]);
  const metadata = JSON.parse(
    await fs.readFile(path.join(results.tableDir, PARAMS_FILE), "utf8"),
  ) as ProcessingMetadata;

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

  const psd = downsamplePsd(
    psdRows
      .map((row) => ({
        f: number(row.frequency_hz),
        raw: number(row.psd_raw),
        processed: number(row.psd_processed),
      }))
      .filter((row) => row.f > 0),
    900,
  ).map((row) => ({ ...row, rawLog: log10(row.raw), processedLog: log10(row.processed) }));

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
      // Absent in results written before the audit (section 7).
      stdDespiked: nullableNumber(global.std_despiked),
      psdRawSource: text(global.psd_raw_source) || "raw",
      median: number(global.median),
      mad: number(global.mad),
      p01: number(global.p01),
      p99: number(global.p99),
      numberOfGaps: number(global.number_of_gaps),
      numberOfOverlaps: number(global.number_of_overlaps),
      filledSamples: number(global.filled_samples),
      gapFill: text(global.gap_fill),
      spikeMethod: text(global.spike_method),
      spikeThresholdRobustZ: number(global.spike_threshold_robust_z),
      spikesDetected: number(global.spikes_detected),
      spikeClusters: number(global.spike_clusters),
      preprocessing: text(global.preprocessing),
      taperSeconds: number(global.taper_seconds),
      // Results written before the filter types existed: bandpass/Butterworth, no notch.
      filterType:
        text(global.filter_type) ||
        (nullableNumber(global.freqmin_hz) === null && nullableNumber(global.freqmax_hz) === null
          ? "none"
          : "bandpass"),
      filterFamily: text(global.filter_family) || "butterworth",
      freqminHz: nullableNumber(global.freqmin_hz),
      freqmaxHz: nullableNumber(global.freqmax_hz),
      filterOrder: number(global.filter_order),
      notchFreqsHz: text(global.notch_freqs_hz)
        .split(";")
        .map(Number)
        .filter((value) => Number.isFinite(value) && value > 0),
      notchQ: nullableNumber(global.notch_q),
      zeroPhase: bool(global.zero_phase),
      staltaMethod: text(global.stalta_method),
      staS: number(global.sta_s),
      ltaS: number(global.lta_s),
      triggerOn: number(global.trigger_on),
      triggerOff: number(global.trigger_off),
      // Absent in results written before the low-SNR options: flag off, nothing discarded.
      lowSnrThreshold: nullableNumber(global.low_snr_threshold),
      eventsLowSnr: number(global.events_low_snr),
      minEventSnr: number(global.min_event_snr),
      eventsDiscardedLowSnr: number(global.events_discarded_low_snr),
    },
    summary,
    qcWindows: qcRows.map((row) => ({
      index: number(row.window_index),
      startUtc: text(row.starttime_utc),
      secondsFromBeginning: number(row.seconds_from_beginning),
      durationS: number(row.duration_s),
      std: number(row.std),
      p99AbsDev: number(row.p99_abs_dev),
      peakAbsDev: number(row.peak_abs_dev),
      rmsProcessed: number(row.rms_processed),
      spikeCount: number(row.spike_count),
      filledFraction: number(row.filled_fraction),
      flatline: bool(row.flatline),
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
      type: text(row.type) || "gap",
    })),
    spikes: spikeRows.map((row) => ({
      sample: number(row.sample),
      timeUtc: text(row.time_utc),
      secondsFromBeginning: number(row.seconds_from_beginning),
      rawAmplitude: number(row.raw_amplitude),
      absAmplitude: Math.abs(number(row.raw_amplitude)),
      spikeId: number(row.spike_id),
    })),
    psd,
    bandEnergy: bandRows.map((row) => ({
      band: text(row.band_hz),
      energyRaw: number(row.energy_raw),
      energyProcessed: number(row.energy_processed),
      percentRaw: nullableNumber(row.percent_raw),
      percentProcessed: nullableNumber(row.percent_processed),
    })),
    events: eventRows.map((row) => ({
      eventId: number(row.event_id),
      sampleOn: number(row.sample_on),
      sampleOff: number(row.sample_off),
      startUtc: text(row.starttime_utc),
      endUtc: text(row.endtime_utc),
      peakUtc: text(row.peak_time_utc),
      startSecondsFromBeginning: number(row.start_seconds_from_beginning),
      durationS: number(row.duration_s),
      maxStaLta: number(row.max_sta_lta),
      maxAbsAmplitudeFiltered: number(row.max_abs_amplitude_filtered),
      rmsFiltered: number(row.rms_filtered),
      snr: nullableNumber(row.snr),
      dominantFrequencyHz: nullableNumber(row.dominant_frequency_hz),
      qcFlags: text(row.qc_flags),
    })),
    run: {
      generatedAtUtc: metadata.generated_at_utc ?? "",
      runtimeS: metadata.result?.runtime_s ?? null,
      software: metadata.software ?? {},
      files: metadata.input?.files ?? [],
      parameters: metadata.parameters ?? {},
      warnings: metadata.warnings ?? [],
    },
    figures: results.figures,
  };
}

interface ProcessingMetadata {
  generated_at_utc?: string;
  software?: Record<string, string>;
  input?: { files?: string[]; trace_id?: string };
  parameters?: Record<string, unknown>;
  warnings?: string[];
  result?: { runtime_s?: number };
}

/**
 * Block maximum instead of taking every n-th row: narrow spectral lines (60 Hz mains hum,
 * a single Welch bin wide) would otherwise disappear from the chart, or seem removed by a
 * notch that never ran.
 */
function downsamplePsd(rows: { f: number; raw: number; processed: number }[], maxPoints: number) {
  if (rows.length <= maxPoints) return rows;
  const step = Math.ceil(rows.length / maxPoints);
  const out: typeof rows = [];
  for (let i = 0; i < rows.length; i += step) {
    const block = rows.slice(i, i + step);
    const peak = block.reduce((best, row) => (row.raw > best.raw ? row : best), block[0]);
    out.push({
      f: peak.f,
      raw: peak.raw,
      processed: Math.max(...block.map((row) => row.processed)),
    });
  }
  return out;
}

function log10(value: number) {
  return value > 0 ? Math.log10(value) : null;
}
