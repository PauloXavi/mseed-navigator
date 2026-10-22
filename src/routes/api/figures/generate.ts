import { createFileRoute } from "@tanstack/react-router";

import { ensureProjectResults, errorResponse } from "@/server/backend-results";

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
    // Only public URLs are returned; server paths stay on the server.
    return Response.json({ figures: result.figures });
  } catch (error) {
    return errorResponse(error, "Falha ao gerar figuras");
  }
}
