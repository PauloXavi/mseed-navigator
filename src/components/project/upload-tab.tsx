import { useCallback, useEffect, useRef, useState } from "react";
import { CloudUpload, FileArchive, Loader2, CheckCircle2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { listUploads, uploadZip, extractArchive } from "@/services/uploads";
import type { UploadRecord } from "@/services/types";
import { formatBytes, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Props {
  projectId: string;
  onExtracted?: () => void;
}

export function UploadTab({ projectId, onExtracted }: Props) {
  const [uploads, setUploads] = useState<UploadRecord[]>([]);
  const [current, setCurrent] = useState<UploadRecord | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(() => setUploads(listUploads(projectId)), [projectId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleFile = useCallback(
    async (file: File) => {
      if (!file.name.toLowerCase().endsWith(".zip")) {
        alert("Apenas arquivos .zip são aceitos nesta fase.");
        return;
      }
      const up = await uploadZip(projectId, file, (u) => setCurrent({ ...u }));
      await extractArchive(projectId, up.id, (u) => setCurrent({ ...u }));
      refresh();
      onExtracted?.();
    },
    [projectId, refresh, onExtracted],
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Upload de arquivo ZIP</CardTitle>
          <CardDescription>
            Envie um arquivo <code className="font-mono text-xs">.zip</code> contendo registros
            MiniSEED. O conteúdo será descompactado e indexado.
          </CardDescription>
          <p
            role="note"
            className="rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-foreground"
          >
            <b>Demonstração:</b> o upload ainda é simulado. Os arquivos enviados aqui não são
            processados; o processamento usa sempre a pasta de dados do servidor:{" "}
            <code className="font-mono">MSEED_DATA_DIR</code>, senão{" "}
            <code className="font-mono">../dados</code>, senão os exemplos de{" "}
            <code className="font-mono">examples/data</code>.
          </p>
        </CardHeader>
        <CardContent>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const f = e.dataTransfer.files?.[0];
              if (f) handleFile(f);
            }}
            className={cn(
              "flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-6 py-12 transition-colors",
              dragOver ? "border-primary bg-primary/5" : "border-border bg-muted/30",
            )}
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <CloudUpload className="h-6 w-6" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium">Arraste um arquivo .zip aqui</p>
              <p className="text-xs text-muted-foreground">
                ou clique para selecionar do computador
              </p>
            </div>
            <input
              ref={inputRef}
              type="file"
              accept=".zip"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
            <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
              Selecionar arquivo
            </Button>
          </div>

          {current && (
            <div className="mt-6 rounded-md border bg-card p-4">
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="font-medium">
                  {current.status === "uploading"
                    ? "Enviando"
                    : current.status === "extracting"
                      ? "Descompactando"
                      : "Concluído"}
                  : {current.fileName}
                </span>
                <span className="text-muted-foreground">{current.progress}%</span>
              </div>
              <Progress value={current.progress} />
              {current.status === "ready" && (
                <div className="mt-3 grid grid-cols-2 gap-3 text-xs md:grid-cols-4">
                  <Stat label="Total de arquivos" value={current.totalFiles ?? 0} />
                  <Stat label="MiniSEED" value={current.mseedFiles ?? 0} />
                  <Stat label="Ignorados" value={current.ignoredFiles ?? 0} />
                  <Stat label="Tamanho" value={formatBytes(current.sizeBytes)} />
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Histórico de uploads</CardTitle>
        </CardHeader>
        <CardContent>
          {uploads.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nenhum upload registrado ainda.
            </p>
          ) : (
            <div className="divide-y">
              {uploads.map((u) => (
                <div key={u.id} className="flex items-center justify-between py-3">
                  <div className="flex items-center gap-3">
                    <FileArchive className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <div className="text-sm font-medium">{u.fileName}</div>
                      <div className="text-xs text-muted-foreground">
                        {formatBytes(u.sizeBytes)} · {formatRelative(u.createdAt)}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    {u.status === "ready" ? (
                      <>
                        <CheckCircle2 className="h-4 w-4 text-success" />
                        <span>{u.mseedFiles} MiniSEED</span>
                      </>
                    ) : (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>{u.status}</span>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md bg-muted/50 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-sm font-semibold">{value}</div>
    </div>
  );
}
