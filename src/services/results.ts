// Results + export (mock).

import type { ProcessingResult } from "./types";
import { readList } from "./store";

const KEY_RESULTS = "mss.results";

export function getProjectResults(projectId: string): ProcessingResult[] {
  return readList<ProcessingResult>(KEY_RESULTS).filter((r) => r.projectId === projectId);
}

export { EXPECTED_ARTIFACTS } from "@/lib/artifacts";

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
