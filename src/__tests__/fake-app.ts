import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { vi } from "vitest";

import { FIGURE_FILES, TABLE_FILES } from "@/lib/artifacts";

/**
 * Temporary app folder with a fake Python in .venv/bin (the first interpreter the server
 * looks for). process.cwd() points at it, so the real project, its results and ../dados are
 * never touched. Every call is logged; FAKE_PYTHON_MODE picks the behaviour:
 *   (unset)   exits 0 without writing anything
 *   write     writes every expected table and figure ("new") into --output-dir
 *   traceback exits 1 with a traceback holding a server path and terminal colour codes
 */
export async function createFakeApp() {
  const appDir = await mkdtemp(path.join(tmpdir(), "mseed-app-"));
  const callLog = path.join(appDir, "python-calls.log");
  const python = path.join(appDir, ".venv", "bin", "python");
  await mkdir(path.dirname(python), { recursive: true });
  await writeFile(python, fakePython(appDir, callLog));
  await chmod(python, 0o755);
  vi.spyOn(process, "cwd").mockReturnValue(appDir);

  const resultsDir = (projectId: string) =>
    path.join(appDir, "public", "backend-results", projectId);

  return {
    appDir,
    resultsDir,
    /** Argument lists Python was started with (empty when it never ran). */
    async pythonCalls() {
      const text = await readFile(callLog, "utf8").catch(() => "");
      return text.split("\n").filter(Boolean);
    },
    /** A complete previous run: every table and figure holding `content`. */
    async writeResults(projectId: string, content: string) {
      const dir = resultsDir(projectId);
      await mkdir(path.join(dir, "tabelas"), { recursive: true });
      await mkdir(path.join(dir, "figuras"), { recursive: true });
      for (const name of TABLE_FILES) await writeFile(path.join(dir, "tabelas", name), content);
      for (const name of FIGURE_FILES) await writeFile(path.join(dir, "figuras", name), content);
    },
    async readResult(projectId: string, file: string) {
      return readFile(path.join(resultsDir(projectId), file), "utf8").catch(() => null);
    },
    /** Folders next to the results (the run's .staging or .previous copies). */
    async resultsSiblings(projectId: string) {
      const names = await readdir(path.dirname(resultsDir(projectId))).catch(() => []);
      return names.filter((name) => name.startsWith(`${projectId}.`));
    },
    async exportLeftovers() {
      return readdir(path.join(appDir, ".cache", "exports")).catch(() => []);
    },
    async cleanup() {
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
      await rm(appDir, { recursive: true, force: true });
    },
  };
}

export type FakeApp = Awaited<ReturnType<typeof createFakeApp>>;

function fakePython(appDir: string, callLog: string) {
  const writeFiles = [
    ...TABLE_FILES.map((name) => `echo new > "$out/tabelas/${name}"`),
    ...FIGURE_FILES.map((name) => `echo new > "$out/figuras/${name}"`),
  ].join("\n    ");
  return `#!/bin/sh
printf '%s\\n' "$*" >> "${callLog}"
out=""
prev=""
for arg in "$@"; do
  if [ "$prev" = "--output-dir" ]; then out="$arg"; fi
  prev="$arg"
done
case "$FAKE_PYTHON_MODE" in
  write)
    mkdir -p "$out/tabelas" "$out/figuras"
    ${writeFiles}
    ;;
  traceback)
    printf 'Traceback (most recent call last):\\n  File "%s/src/server/extract_timeseries.py", line 9\\n\\033[31mValueError\\033[0m: boom\\n' "${appDir}" >&2
    exit 1
    ;;
esac
exit 0
`;
}

type Handler = (context: { params: Record<string, string>; request: Request }) => Promise<Response>;

/** The server handler of a file route, called directly with a Request. */
export function routeHandler(route: unknown, method: "GET" | "POST" | "DELETE") {
  const options = (route as { options: { server: { handlers: Record<string, Handler> } } }).options;
  return options.server.handlers[method];
}
