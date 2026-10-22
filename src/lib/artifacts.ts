// Artifacts written by backend/mseed_processing.py.
// Single source of truth for the server routes and the UI; keep in sync with the
// file-name constants at the top of the Python module.

export const CSV_FILES = [
  "resumo_por_arquivo.csv",
  "resumo_global.csv",
  "gaps.csv",
  "spikes_detectados.csv",
  "psd_welch.csv",
  "energia_por_banda.csv",
  "eventos_candidatos_sta_lta.csv",
  "indicadores_por_janela.csv",
];

export const PARAMS_FILE = "parametros_processamento.json";

export const TABLE_FILES = [...CSV_FILES, PARAMS_FILE];

export const FIGURE_FILES = [
  "visao_geral_24h_bruto.png",
  "indicadores_por_minuto.png",
  "psd_bruto_processado.png",
  "janela_inicial_bruto_processado.png",
  "espectrograma_janela_inicial.png",
  "janela_spike_bruto_processado.png",
  "funcao_sta_lta_24h.png",
  "principal_evento_candidato.png",
];

export const EXPECTED_ARTIFACTS = [
  ...CSV_FILES.map((name) => ({ name, kind: "csv" as const })),
  { name: PARAMS_FILE, kind: "json" as const },
  ...FIGURE_FILES.map((name) => ({ name, kind: "figure" as const })),
];
