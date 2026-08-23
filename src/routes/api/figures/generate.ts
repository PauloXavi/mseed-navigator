import { createFileRoute } from "@tanstack/react-router";

import { ensureProjectResults } from "@/server/backend-results";

export const Route = createFileRoute("/api/figures/generate")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        return handleGenerateFigures(url.searchParams.get("projectId") ?? "", false);
      },
      POST: async ({ request }) => {
        const body = (await request.json().catch(() => ({}))) as {
          projectId?: unknown;
          force?: unknown;
        };
        const projectId = typeof body.projectId === "string" ? body.projectId : "";
        return handleGenerateFigures(projectId, body.force === true);
      },
    },
  },
});

async function handleGenerateFigures(projectId: string, force: boolean) {
  try {
    const result = await ensureProjectResults(projectId, force);
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao gerar figuras";
    return Response.json({ error: message }, { status: 500 });
  }
}
