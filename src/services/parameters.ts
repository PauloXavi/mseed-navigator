// Processing-parameter helpers shared by the UI and the server routes.

import { DEFAULT_PARAMETERS } from "./types";
import type { FilterType, ProcessingParameters } from "./types";

export const SPIKE_METHODS = ["residual", "global"] as const;
export const GAP_FILL_METHODS = ["interpolate", "median"] as const;
export const STALTA_METHODS = ["classic", "recursive"] as const;
export const FILTER_TYPES = ["bandpass", "highpass", "lowpass", "bandstop"] as const;
export const FILTER_FAMILIES = ["butterworth", "bessel"] as const;

/** Which limits (freqmin, freqmax) a filter type uses; mirrors filter_uses() in Python. */
export function filterUses(type: FilterType) {
  return {
    min: type === "bandpass" || type === "highpass" || type === "bandstop",
    max: type === "bandpass" || type === "lowpass" || type === "bandstop",
  };
}

/** Parses "60, 29" into [60, 29]; invalid items become NaN so validation reports them. */
export function parseFrequencyList(text: string): number[] {
  return text
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(item) ? Number(item) : Number.NaN));
}

/**
 * Parses the notch field typed by the user. Values are separated by ", " (comma and space),
 * ";" or spaces. A comma between digits ("59,5" or "60,29") is ambiguous: as a pt-BR
 * decimal it would silently become two notches (59 and 5 Hz), so it yields NaN and the
 * field asks for a dot. Use parseFrequencyList for the internal "60,29" format.
 */
export function parseFrequencyInput(text: string): number[] {
  return text
    .split(/;|,\s+|\s+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(item) ? Number(item) : Number.NaN));
}

/** True when the text has a comma between digits (pt-BR decimal or missing space). */
export function hasDecimalComma(text: string) {
  return /\d,\d/.test(text);
}

/** Fills fields missing from older saved jobs with the current defaults. */
export function withParameterDefaults(
  partial: Partial<ProcessingParameters> | undefined,
): ProcessingParameters {
  return {
    ...DEFAULT_PARAMETERS,
    ...partial,
    notchFreqs: partial?.notchFreqs ?? [...DEFAULT_PARAMETERS.notchFreqs],
    steps: { ...DEFAULT_PARAMETERS.steps, ...partial?.steps },
  };
}

/** Same rules as ProcessingConfig.validate() in the Python backend. */
export function validateParameters(p: ProcessingParameters): string[] {
  const errors: string[] = [];
  const uses = filterUses(p.filterType);
  const numeric: (keyof ProcessingParameters)[] = [
    // Only the limits the filter type uses must be filled in (the UI hides the other one).
    ...(uses.min ? (["freqmin"] as const) : []),
    ...(uses.max ? (["freqmax"] as const) : []),
    "filterOrder",
    "spikeZ",
    "spikeWindow",
    "spikeMaxWidth",
    "taperSeconds",
    "taperMaxFraction",
    "qcWindowSeconds",
    "welchNperseg",
    "sta",
    "lta",
    "triggerOn",
    "triggerOff",
    "maxEventSeconds",
    "minEventSeconds",
    "lowSnrThreshold",
    "minEventSnr",
  ];
  for (const key of numeric) {
    if (typeof p[key] !== "number" || !Number.isFinite(p[key])) {
      errors.push(`${key} precisa ser numérico`);
    }
  }
  if (errors.length) return errors;

  if (!FILTER_TYPES.includes(p.filterType)) errors.push("tipo de filtro inválido");
  if (!FILTER_FAMILIES.includes(p.filterFamily)) errors.push("família de filtro inválida");
  if (uses.min && p.freqmin <= 0) errors.push("freqmin deve ser positiva");
  if (uses.max && p.freqmax <= 0) errors.push("freqmax deve ser positiva");
  if (uses.min && uses.max && p.freqmax <= p.freqmin)
    errors.push("freqmax deve ser maior que freqmin");
  if (p.notch) {
    if (p.notchFreqs.length === 0) errors.push("informe ao menos uma frequência de notch");
    if (p.notchFreqs.some((f) => !Number.isFinite(f) || f <= 0))
      errors.push("frequências de notch devem ser números positivos");
    if (!Number.isFinite(p.notchQ) || p.notchQ <= 0) errors.push("Q do notch deve ser positivo");
  }
  if (!Number.isInteger(p.filterOrder) || p.filterOrder < 1 || p.filterOrder > 10)
    errors.push("ordem do filtro deve ser um inteiro entre 1 e 10");
  if (!SPIKE_METHODS.includes(p.spikeMethod)) errors.push("método de spike inválido");
  if (p.spikeZ <= 0) errors.push("spike_z deve ser positivo");
  if (!Number.isInteger(p.spikeWindow) || p.spikeWindow < 3)
    errors.push("janela de spike deve ser um inteiro >= 3 amostras");
  if (!Number.isInteger(p.spikeMaxWidth) || p.spikeMaxWidth < 1)
    errors.push("largura máxima de spike deve ser um inteiro >= 1");
  if (p.taperSeconds < 0) errors.push("taper não pode ser negativo");
  if (p.taperMaxFraction < 0 || p.taperMaxFraction > 0.5)
    errors.push("fração máxima do taper deve estar entre 0 e 0.5");
  if (!GAP_FILL_METHODS.includes(p.gapFill)) errors.push("preenchimento de gaps inválido");
  if (p.qcWindowSeconds < 1) errors.push("janela de QC deve ser de pelo menos 1 s");
  if (!Number.isInteger(p.welchNperseg) || p.welchNperseg < 16)
    errors.push("nperseg de Welch deve ser um inteiro >= 16");
  if (!STALTA_METHODS.includes(p.staltaMethod)) errors.push("método STA/LTA inválido");
  if (p.sta <= 0) errors.push("STA deve ser positivo");
  if (p.lta <= p.sta) errors.push("LTA deve ser maior que STA");
  if (p.triggerOn <= 0) errors.push("trigger_on deve ser positivo");
  if (p.triggerOff < 0 || p.triggerOff >= p.triggerOn)
    errors.push("trigger_off deve estar entre 0 e trigger_on");
  if (p.maxEventSeconds < 0) errors.push("duração máxima não pode ser negativa (0 = sem limite)");
  if (p.minEventSeconds < 0) errors.push("duração mínima não pode ser negativa");
  if (p.lowSnrThreshold <= 0) errors.push("limiar de SNR baixo deve ser positivo");
  if (p.minEventSnr < 0) errors.push("SNR mínimo não pode ser negativo (0 = não descarta)");
  // No leading "-": the id becomes a CLI argument and would be parsed as an option.
  if (p.traceId && !/^(?!-)[\w*?-]*\.[\w*?-]*\.[\w*?-]*\.[\w*?-]*$/.test(p.traceId))
    errors.push("trace id deve ter o formato NET.STA.LOC.CHA (aceita * e ?)");
  return errors;
}
