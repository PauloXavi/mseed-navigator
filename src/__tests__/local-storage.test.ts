// D-1 and D-2 of the 2026-10-22 audit (CHANGELOG.md): data saved in localStorage by
// older versions (or edited by hand) must not crash the pages. Outside a browser, store.ts
// keeps the same JSON in memory, so writeKey reproduces exactly what the browser would read.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ProjectStatusBadge } from "@/components/status-badges";
import { getLastParameters, listJobs } from "@/services/processing";
import { getProject, listProjects } from "@/services/projects";
import { writeKey } from "@/services/store";
import { DEFAULT_PARAMETERS, type ProjectStatus } from "@/services/types";

const EPOCH = new Date(0).toISOString();

describe("D-1: projects saved by older versions do not break the pages", () => {
  it("fills the missing fields and skips entries without an id", () => {
    writeKey("mss.projects", [{ id: "prj_old", name: "Antigo" }, { name: "sem id" }, null, "x"]);

    expect(listProjects()).toEqual([
      {
        id: "prj_old",
        name: "Antigo",
        status: "created",
        fileCount: 0,
        createdAt: EPOCH,
        updatedAt: EPOCH,
      },
    ]);
    expect(getProject("prj_old")?.status).toBe("created");
  });

  it("reads a stored value that is not a list as no projects", () => {
    writeKey("mss.projects", { id: "prj_old" });
    expect(listProjects()).toEqual([]);
  });

  it("shows an unknown status as 'Criado' instead of crashing", () => {
    const html = renderToStaticMarkup(
      createElement(ProjectStatusBadge, { status: "arquivado" as ProjectStatus }),
    );
    expect(html).toContain("Criado");
  });
});

describe("D-2: a corrupted job history does not break the Processing tab", () => {
  it("reads a stored value that is not a list as no jobs", () => {
    writeKey("mss.jobs", {});

    expect(listJobs("prj_x")).toEqual([]);
    expect(getLastParameters("prj_x")).toEqual(DEFAULT_PARAMETERS);
  });

  it("skips jobs without the fields the UI relies on", () => {
    writeKey("mss.jobs", [
      { projectId: "prj_x", status: "completed" },
      "x",
      {
        id: "job_ok",
        projectId: "prj_x",
        startedAt: "2026-10-22T05:00:00Z",
        status: "completed",
        parameters: { freqmax: 40 },
      },
    ]);

    expect(listJobs("prj_x").map((job) => job.id)).toEqual(["job_ok"]);
    expect(getLastParameters("prj_x")).toEqual({ ...DEFAULT_PARAMETERS, freqmax: 40 });
  });
});
