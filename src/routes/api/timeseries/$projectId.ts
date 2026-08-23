import { createFileRoute } from "@tanstack/react-router";

import { assertValidProjectId, fileExists } from "@/server/backend-results";

export const Route = createFileRoute("/api/timeseries/$projectId")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        try {
          assertValidProjectId(params.projectId);

          const url = new URL(request.url);
          const start = url.searchParams.get("start") ?? "";
          const end = url.searchParams.get("end") ?? "";
          const maxPoints = Number(url.searchParams.get("maxPoints") ?? "900");

          if (!start || !end) {
            return Response.json({ error: "Informe início e fim UTC." }, { status: 400 });
          }

          const payload = await extractTimeseries(start, end, maxPoints);
          return Response.json(payload);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Falha ao carregar série temporal";
          return Response.json({ error: message }, { status: 500 });
        }
      },
    },
  },
});

async function extractTimeseries(start: string, end: string, maxPoints: number) {
  const path = await import("node:path");
  const { spawn } = await import("node:child_process");

  const appDir = process.cwd();
  const workspaceDir = appDir;
  const dataDir = path.join(workspaceDir, "examples", "data");
  const scriptPath = path.join(appDir, "src", "server", "extract_timeseries.py");
  const venvPython = path.join(workspaceDir, ".venv", "bin", "python");
  const python = (await fileExists(venvPython)) ? venvPython : "python3";

  const output = await runJsonProcess(
    python,
    [
      scriptPath,
      "--data-dir",
      dataDir,
      "--start",
      toUtcIso(start),
      "--end",
      toUtcIso(end),
      "--max-points",
      String(Number.isFinite(maxPoints) ? maxPoints : 900),
    ],
    { cwd: workspaceDir },
    spawn,
  );

  return JSON.parse(output) as unknown;
}

function toUtcIso(value: string) {
  return value.endsWith("Z") ? value : `${value}:00Z`;
}

function runJsonProcess(
  command: string,
  args: string[],
  options: { cwd: string },
  spawn: typeof import("node:child_process").spawn,
) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, options);
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }
      reject(new Error(stderr.trim() || stdout.trim() || `Processo finalizado com código ${code}`));
    });
  });
}
