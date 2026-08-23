export const CSV_FILES = [
  "resumo_por_arquivo.csv",
  "resumo_global.csv",
  "gaps.csv",
  "spikes_detectados.csv",
  "psd_welch.csv",
  "energia_por_banda.csv",
  "eventos_candidatos_sta_lta.csv",
];

export const FIGURE_FILES = [
  "visao_geral_24h_bruto.png",
  "indicadores_por_minuto.png",
  "psd_bruto_processado.png",
  "janela_inicial_bruto_processado.png",
  "espectrograma_janela_inicial.png",
  "funcao_sta_lta_24h.png",
  "principal_evento_candidato.png",
];

export function assertValidProjectId(projectId: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(projectId)) {
    throw new Error("projectId inválido");
  }
}

export async function ensureProjectResults(projectId: string, force = false) {
  assertValidProjectId(projectId);

  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const { spawn } = await import("node:child_process");

  const appDir = process.cwd();
  const workspaceDir = appDir;
  const outputDir = path.join(appDir, "public", "backend-results", projectId);
  const tableDir = path.join(outputDir, "tabelas");
  const figureDir = path.join(outputDir, "figuras");

  await fs.mkdir(tableDir, { recursive: true });
  await fs.mkdir(figureDir, { recursive: true });

  const expectedPaths = [
    ...CSV_FILES.map((name) => path.join(tableDir, name)),
    ...FIGURE_FILES.map((name) => path.join(figureDir, name)),
  ];
  const existing = await Promise.all(expectedPaths.map(fileExists));

  if (force || existing.some((ok) => !ok)) {
    const scriptPath = path.join(workspaceDir, "backend", "mseed_processing.py");
    const dataDir = path.join(workspaceDir, "examples", "data");
    const venvPython = path.join(workspaceDir, ".venv", "bin", "python");
    const python = (await fileExists(venvPython)) ? venvPython : "python3";
    const mplConfigDir = path.join(appDir, ".cache", "matplotlib");

    await fs.mkdir(mplConfigDir, { recursive: true });

    await runProcess(
      python,
      [scriptPath, "--data-dir", dataDir, "--output-dir", outputDir],
      {
        cwd: workspaceDir,
        env: {
          ...process.env,
          MPLCONFIGDIR: mplConfigDir,
          PYTHONUNBUFFERED: "1",
        },
      },
      spawn,
    );
  }

  return {
    appDir,
    outputDir,
    tableDir,
    figureDir,
    csvFiles: CSV_FILES.map((name) => path.join(tableDir, name)),
    figureFiles: FIGURE_FILES.map((name) => path.join(figureDir, name)),
    figures: FIGURE_FILES.map((name) => ({
      name,
      url: `/backend-results/${projectId}/figuras/${name}`,
    })),
  };
}

export async function fileExists(filePath: string) {
  const fs = await import("node:fs/promises");
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export function runProcess(
  command: string,
  args: string[],
  options: {
    cwd: string;
    env?: NodeJS.ProcessEnv;
  },
  spawn: typeof import("node:child_process").spawn,
) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, options);
    let output = "";

    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(output.trim() || `Processo finalizado com código ${code}`));
    });
  });
}
