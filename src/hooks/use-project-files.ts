import { useEffect, useState } from "react";

import { listFiles } from "@/services/files";
import type { MseedFile } from "@/services/types";

/**
 * MiniSEED files of a project as indexed by the Python backend (/api/files).
 * Falls back to the locally stored list when the backend is unavailable.
 */
export function useProjectFiles(projectId: string) {
  const [files, setFiles] = useState<MseedFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");

    fetch(`/api/files/${projectId}`)
      .then(async (response) => {
        const payload = (await response.json()) as { files?: MseedFile[]; error?: string };
        if (!response.ok) throw new Error(payload.error ?? "Falha ao carregar arquivos reais");
        return payload.files ?? [];
      })
      .then((realFiles) => {
        if (!cancelled) setFiles(realFiles);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Falha ao carregar arquivos reais");
        setFiles(listFiles(projectId));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return { files, setFiles, loading, error };
}
