// Results + export (mock).

import type { ProcessingResult } from "./types";
import { readKey } from "./store";

const KEY_RESULTS = "mss.results";

export function getProjectResults(projectId: string): ProcessingResult[] {
  return readKey<ProcessingResult[]>(KEY_RESULTS, []).filter((r) => r.projectId === projectId);
}

export const EXPECTED_ARTIFACTS = [
  { name: "resumo_por_arquivo.csv", kind: "csv" as const },
  { name: "resumo_global.csv", kind: "csv" as const },
  { name: "gaps.csv", kind: "csv" as const },
  { name: "spikes_detectados.csv", kind: "csv" as const },
  { name: "psd_welch.csv", kind: "csv" as const },
  { name: "energia_por_banda.csv", kind: "csv" as const },
  { name: "eventos_candidatos_sta_lta.csv", kind: "csv" as const },
  { name: "visao_geral_24h_bruto.png", kind: "figure" as const },
  { name: "indicadores_por_minuto.png", kind: "figure" as const },
  { name: "psd_bruto_processado.png", kind: "figure" as const },
  { name: "janela_inicial_bruto_processado.png", kind: "figure" as const },
  { name: "espectrograma_janela_inicial.png", kind: "figure" as const },
  { name: "funcao_sta_lta_24h.png", kind: "figure" as const },
  { name: "principal_evento_candidato.png", kind: "figure" as const },
];

export interface ExportOptions {
  includeCsv?: boolean;
  includeFigures?: boolean;
  bundleZip?: boolean;
}

export async function exportResults(
  projectId: string,
  options: ExportOptions,
): Promise<{ ok: true; requested: ExportOptions; projectId: string }> {
  const kind = options.bundleZip ? "bundle" : options.includeFigures ? "figures" : "csv";
  window.location.assign(`/api/exports/${projectId}/${kind}`);
  return { ok: true, requested: options, projectId };
}
