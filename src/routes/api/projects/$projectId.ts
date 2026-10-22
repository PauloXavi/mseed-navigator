import { createFileRoute } from "@tanstack/react-router";

import { deleteProjectArtifacts, errorResponse } from "@/server/backend-results";

export const Route = createFileRoute("/api/projects/$projectId")({
  server: {
    handlers: {
      DELETE: async ({ params }) => {
        try {
          await deleteProjectArtifacts(params.projectId);
          return Response.json({ ok: true });
        } catch (error) {
          return errorResponse(error, "Falha ao excluir projeto");
        }
      },
    },
  },
});
