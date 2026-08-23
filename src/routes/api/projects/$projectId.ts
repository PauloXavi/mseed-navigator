import { createFileRoute } from "@tanstack/react-router";

import { assertValidProjectId } from "@/server/backend-results";

export const Route = createFileRoute("/api/projects/$projectId")({
  server: {
    handlers: {
      DELETE: async ({ params }) => {
        try {
          await deleteProjectArtifacts(params.projectId);
          return Response.json({ ok: true });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Falha ao excluir projeto";
          return Response.json({ error: message }, { status: 500 });
        }
      },
    },
  },
});

async function deleteProjectArtifacts(projectId: string) {
  assertValidProjectId(projectId);

  const fs = await import("node:fs/promises");
  const path = await import("node:path");

  const appDir = process.cwd();
  const outputDir = path.join(appDir, "public", "backend-results", projectId);
  await fs.rm(outputDir, { recursive: true, force: true });
}
