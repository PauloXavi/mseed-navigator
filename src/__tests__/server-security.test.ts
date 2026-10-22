// Regression tests for the server findings of the 2026-10-22 audit (CHANGELOG.md).
// The routes run for real against a temporary app folder with a fake Python (fake-app.ts).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Route as processRoute } from "@/routes/api/process/$projectId";
import { Route as timeseriesRoute } from "@/routes/api/timeseries/$projectId";
import {
  HttpError,
  buildPipelineArgs,
  ensureProjectResults,
  getProcessingStatus,
  publicProcessError,
} from "@/server/backend-results";
import { validateParameters } from "@/services/parameters";
import { DEFAULT_PARAMETERS } from "@/services/types";

import { createFakeApp, routeHandler, type FakeApp } from "./fake-app";

let app: FakeApp;
beforeEach(async () => {
  app = await createFakeApp();
});
afterEach(async () => {
  await app.cleanup();
});

const postProcess = routeHandler(processRoute, "POST");
const getTimeseries = routeHandler(timeseriesRoute, "GET");

function startRun(projectId: string, body: object) {
  const request = new Request(`http://localhost/api/process/${projectId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return postProcess({ params: { projectId }, request });
}

function readTimeseries(projectId: string, query: Record<string, string>) {
  const url = new URL(`http://localhost/api/timeseries/${projectId}`);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return getTimeseries({ params: { projectId }, request: new Request(url) });
}

const ONE_MINUTE = { start: "2026-01-01T00:00:00Z", end: "2026-01-01T00:01:00Z" };

describe("B-1: file names cannot become pipeline options", () => {
  it("rejects a name starting with '-' before Python runs", async () => {
    const response = await startRun("prj_b1", {
      fileNames: ["SY.SYN01.00.HHZ.mseed", "--output-dir=audit_injection_out"],
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Nome de arquivo inválido na seleção." });
    expect(await app.pythonCalls()).toEqual([]);
  });

  it.each(["-x.mseed", "../dados/x.mseed", "a/b.mseed", ".oculto.mseed"])("rejects %s", (name) => {
    expect(() => buildPipelineArgs(DEFAULT_PARAMETERS, [name])).toThrow(HttpError);
  });

  it("passes plain MiniSEED names on to the pipeline, accented ones included", () => {
    const names = [
      "SY.SYN01.00.HHZ.2026.001.0000.mseed",
      "estação_01.mseed",
      "estação_02.mseed".normalize("NFD"),
      "dia 2.mseed",
    ];
    expect(buildPipelineArgs(DEFAULT_PARAMETERS, names).slice(-5)).toEqual(["--files", ...names]);
  });
});

describe("B-2: a run without output keeps the previous results", () => {
  it("keeps them when Python exits 0 without writing anything", async () => {
    await app.writeResults("prj_b2", "old");

    const response = await startRun("prj_b2", {});
    expect(response.status).toBe(202);
    await vi.waitFor(
      async () => expect((await getProcessingStatus("prj_b2")).status).toBe("error"),
      {
        timeout: 5000,
      },
    );

    expect((await getProcessingStatus("prj_b2")).error).toBe(
      "O processamento terminou sem gerar resultados.",
    );
    expect(await app.readResult("prj_b2", "tabelas/resumo_global.csv")).toBe("old");
    expect(await app.resultsSiblings("prj_b2")).toEqual([]);
  });

  it("replaces them when the run succeeds", async () => {
    vi.stubEnv("FAKE_PYTHON_MODE", "write");
    await app.writeResults("prj_b2_ok", "old");

    await ensureProjectResults("prj_b2_ok", true);

    expect(await app.readResult("prj_b2_ok", "tabelas/resumo_global.csv")).toBe("new\n");
    expect(await app.resultsSiblings("prj_b2_ok")).toEqual([]);
  });
});

describe("B-3: invalid input and Python errors do not leak to the client", () => {
  it.each([
    [{ start: "abc", end: ONE_MINUTE.end }, "Início ou fim UTC inválido (use AAAA-MM-DDTHH:MM)."],
    [
      { start: "2026-01-01T00:00", end: "abc:00Z" },
      "Início ou fim UTC inválido (use AAAA-MM-DDTHH:MM).",
    ],
    [{ start: ONE_MINUTE.end, end: ONE_MINUTE.start }, "O fim precisa ser depois do início."],
    [
      { start: ONE_MINUTE.start, end: "2026-03-15T00:00:00Z" },
      "Janela longa demais (máximo de 48 h).",
    ],
  ])("answers 400 to %o without running Python", async (query, message) => {
    const response = await readTimeseries("prj_b3", query);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: message });
    expect(await app.pythonCalls()).toEqual([]);
  });

  it("hides a Python traceback, its server paths and colour codes", async () => {
    vi.stubEnv("FAKE_PYTHON_MODE", "traceback");
    const serverLog = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await readTimeseries("prj_b3", ONE_MINUTE);
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(500);
    expect(body.error).toBe("Falha ao ler a série temporal. Detalhes no log do servidor.");
    expect(serverLog).toHaveBeenCalledWith(expect.stringContaining("Traceback"));
  });

  it("keeps the pipeline's own message, without paths or colour codes", () => {
    const esc = String.fromCharCode(27);
    const output = [
      "Lendo arquivos...",
      `${esc}[31mErro: arquivo /Users/alguem/dados/SY.SYN01.00.HHZ.mseed ilegivel${esc}[0m`,
    ].join("\n");

    expect(publicProcessError(output)).toBe("Erro: arquivo SY.SYN01.00.HHZ.mseed ilegivel");
  });

  it("keeps argparse errors", () => {
    const output = "usage: extract_timeseries.py [-h]\nextract_timeseries.py: error: bad --start";
    expect(publicProcessError(output)).toBe("extract_timeseries.py: error: bad --start");
  });
});

describe("B-4: a trace id cannot start with '-'", () => {
  it("is rejected by the form validation and by the pipeline arguments", () => {
    const params = { ...DEFAULT_PARAMETERS, traceId: "-.-.-.-" };

    expect(validateParameters(params)).toContain(
      "trace id deve ter o formato NET.STA.LOC.CHA (aceita * e ?)",
    );
    expect(() => buildPipelineArgs(params)).toThrow(HttpError);
    expect(validateParameters({ ...DEFAULT_PARAMETERS, traceId: "SY.SYN01.00.HHZ" })).toEqual([]);
  });

  it("is rejected by the time-series API before Python runs", async () => {
    const response = await readTimeseries("prj_b4", { ...ONE_MINUTE, traceId: "-.-.-.-" });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "traceId inválido." });
    expect(await app.pythonCalls()).toEqual([]);
  });
});

describe("B-6: the file selection has an upper bound", () => {
  it("rejects more than 10 000 names before Python runs", async () => {
    const fileNames = Array.from({ length: 10_001 }, (_, i) => `f${i}.mseed`);

    const response = await startRun("prj_b6", { fileNames });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Seleção com arquivos demais (máximo 10000).",
    });
    expect(await app.pythonCalls()).toEqual([]);
  });

  it("accepts exactly 10 000 names", () => {
    const fileNames = Array.from({ length: 10_000 }, (_, i) => `f${i}.mseed`);
    expect(buildPipelineArgs(DEFAULT_PARAMETERS, fileNames)).toHaveLength(
      buildPipelineArgs(DEFAULT_PARAMETERS).length + 1 + 10_000,
    );
  });
});
