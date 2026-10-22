// B-5 of the 2026-10-22 audit (CHANGELOG.md): the export route builds each ZIP in a
// temporary folder under .cache/exports, which must go away on failure too.

import { chmod } from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TABLE_FILES } from "@/lib/artifacts";
import { Route as exportRoute } from "@/routes/api/exports/$projectId/$kind";

import { createFakeApp, routeHandler, type FakeApp } from "./fake-app";

let app: FakeApp;
beforeEach(async () => {
  app = await createFakeApp();
});
afterEach(async () => {
  await app.cleanup();
});

const getExport = routeHandler(exportRoute, "GET");

function download(projectId: string, kind: string) {
  const request = new Request(`http://localhost/api/exports/${projectId}/${kind}`);
  return getExport({ params: { projectId, kind }, request });
}

describe("B-5: the export never leaves its temporary folder behind", () => {
  it.each(["csv", "figures", "bundle"])("removes it after a %s download", async (kind) => {
    await app.writeResults("prj_b5", "conteudo");

    const response = await download("prj_b5", kind);
    const zip = Buffer.from(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(zip.subarray(0, 2).toString()).toBe("PK");
    expect(await app.exportLeftovers()).toEqual([]);
    expect(await app.pythonCalls()).toEqual([]);
  });

  it("removes it when zip fails", async () => {
    await app.writeResults("prj_b5_err", "conteudo");
    await chmod(path.join(app.resultsDir("prj_b5_err"), "tabelas", TABLE_FILES[0]), 0o000);

    const response = await download("prj_b5_err", "csv");
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(500);
    expect(body.error).toMatch(/^zip (warning|error):/);
    expect(body.error).not.toContain(app.appDir);
    expect(await app.exportLeftovers()).toEqual([]);
  });
});
