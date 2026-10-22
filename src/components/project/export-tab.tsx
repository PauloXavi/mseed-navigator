import { useState } from "react";
import { Download, FileText, Image, Package, FileArchive } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { EXPECTED_ARTIFACTS, exportResults } from "@/services/results";
import { toast } from "sonner";

interface Props {
  projectId: string;
}

export function ExportTab({ projectId }: Props) {
  const [busy, setBusy] = useState<string | null>(null);

  async function run(kind: string, opts: Parameters<typeof exportResults>[1]) {
    setBusy(kind);
    try {
      await exportResults(projectId, opts);
      toast.success(`Download iniciado: ${kind}`, {
        description: "O backend preparou um arquivo .zip com os artefatos selecionados.",
      });
    } finally {
      setBusy(null);
    }
  }

  const actions = [
    {
      key: "csv",
      label: "Baixar CSVs",
      description: "Tabelas CSV e parâmetros do processamento (JSON)",
      icon: FileText,
      opts: { includeCsv: true },
    },
    {
      key: "figures",
      label: "Baixar figuras",
      description: "Todos os PNGs gerados",
      icon: Image,
      opts: { includeFigures: true },
    },
    {
      key: "bundle",
      label: "Pacote completo .zip",
      description: "CSVs e figuras em um único arquivo",
      icon: Package,
      opts: { includeCsv: true, includeFigures: true, bundleZip: true },
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        {actions.map((a) => {
          const Icon = a.icon;
          return (
            <Card key={a.key}>
              <CardContent className="flex items-center justify-between gap-4 p-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold">{a.label}</div>
                    <div className="text-xs text-muted-foreground">{a.description}</div>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() => run(a.label, a.opts)}
                >
                  <Download className="mr-2 h-4 w-4" />
                  {busy === a.label ? "..." : "Baixar"}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Artefatos esperados</CardTitle>
          <CardDescription>
            Lista dos arquivos que o pipeline gera após o processamento completo.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {EXPECTED_ARTIFACTS.map((a) => (
              <div
                key={a.name}
                className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-xs"
              >
                {a.kind === "figure" ? (
                  <FileArchive className="h-3.5 w-3.5 text-chart-3" />
                ) : (
                  <FileText className="h-3.5 w-3.5 text-info" />
                )}
                <span className="font-mono">{a.name}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
