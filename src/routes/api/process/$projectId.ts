import { createFileRoute } from "@tanstack/react-router";

import {
  HttpError,
  cancelProcessing,
  errorResponse,
  getProcessingStatus,
  startProcessing,
} from "@/server/backend-results";
import { withParameterDefaults } from "@/services/parameters";
import type { ProcessingParameters } from "@/services/types";

export const Route = createFileRoute("/api/process/$projectId")({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        try {
          const body = (await request.json().catch(() => {
            throw new HttpError(400, "Corpo JSON inválido");
          })) as { parameters?: Partial<ProcessingParameters>; fileNames?: unknown };
          const fileNames = Array.isArray(body.fileNames)
            ? body.fileNames.filter((name): name is string => typeof name === "string")
            : [];
          const status = await startProcessing(
            params.projectId,
            withParameterDefaults(body.parameters),
            fileNames,
          );
          return Response.json(status, { status: 202 });
        } catch (error) {
          return errorResponse(error, "Falha ao iniciar processamento");
        }
      },
      GET: async ({ params }) => {
        try {
          return Response.json(await getProcessingStatus(params.projectId));
        } catch (error) {
          return errorResponse(error, "Falha ao consultar processamento");
        }
      },
      DELETE: async ({ params }) => {
        try {
          return Response.json(await cancelProcessing(params.projectId));
        } catch (error) {
          return errorResponse(error, "Falha ao cancelar processamento");
        }
      },
    },
  },
});
