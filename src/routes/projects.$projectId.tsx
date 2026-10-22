import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, BarChart3, Download, FileText, LineChart, Play, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Toaster } from "@/components/ui/sonner";
import { ProjectStatusBadge } from "@/components/status-badges";
import { getProject, updateProject } from "@/services/projects";
import type { Project } from "@/services/types";
import { getActiveJob, getLastParameters, startProcessingJob } from "@/services/processing";
import { formatRelative } from "@/lib/format";
import { toast } from "sonner";

import { UploadTab } from "@/components/project/upload-tab";
import { FilesTab } from "@/components/project/files-tab";
import { InspectionTab } from "@/components/project/inspection-tab";
import { ProcessingTab } from "@/components/project/processing-tab";
import { ResultsTab } from "@/components/project/results-tab";
import { ExportTab } from "@/components/project/export-tab";

export const Route = createFileRoute("/projects/$projectId")({
  head: () => ({
    meta: [
      { title: "Projeto — miniSEED Studio" },
      { name: "description", content: "Ambiente de análise MiniSEED do projeto." },
    ],
  }),
  component: ProjectPage,
});

const TABS = [
  { value: "upload", label: "Upload", icon: Upload },
  { value: "files", label: "Arquivos", icon: FileText },
  { value: "inspection", label: "Inspeção", icon: LineChart },
  { value: "processing", label: "Processamento", icon: Play },
  { value: "results", label: "Resultados", icon: BarChart3 },
  { value: "export", label: "Exportação", icon: Download },
] as const;

function ProjectPage() {
  const { projectId } = Route.useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | undefined>();
  const [tab, setTab] = useState<string>("upload");
  const [selection, setSelection] = useState<string[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [processingViewKey, setProcessingViewKey] = useState(0);

  useEffect(() => {
    const p = getProject(projectId);
    if (!p) navigate({ to: "/" });
    else {
      setProject(p);
      if (p.fileCount > 0) setTab("files");
    }
  }, [projectId, navigate, refreshKey]);

  const handleJobChange = useCallback(() => {
    const updated = getProject(projectId);
    if (updated) setProject(updated);
  }, [projectId]);

  const handleFilesLoaded = useCallback(
    (count: number) => {
      // Persisted so the header and the project list keep the count after a reload.
      if (getProject(projectId)?.fileCount !== count)
        updateProject(projectId, { fileCount: count });
      setProject((current) =>
        current && current.fileCount !== count ? { ...current, fileCount: count } : current,
      );
    },
    [projectId],
  );

  if (!project) return null;

  async function handleProcessSelection(files: { fileIds: string[]; fileNames: string[] }) {
    const activeJob = getActiveJob(projectId);
    if (activeJob) {
      setTab("processing");
      toast.info("Já existe um processamento em andamento", {
        description: "Acompanhe ou cancele o job atual antes de iniciar outro.",
      });
      return;
    }

    try {
      await startProcessingJob({
        projectId,
        mode: "selected",
        fileIds: files.fileIds,
        fileNames: files.fileNames,
        parameters: getLastParameters(projectId),
      });
    } catch (error) {
      toast.error("Não foi possível iniciar o processamento", {
        description: error instanceof Error ? error.message : undefined,
      });
      return;
    }
    const updatedProject = getProject(projectId);
    if (updatedProject) setProject(updatedProject);
    setProcessingViewKey((key) => key + 1);
    setTab("processing");
    toast.success("Processamento iniciado", {
      description: `${files.fileIds.length} arquivo(s) selecionado(s).`,
    });
  }

  return (
    <div className="min-h-screen bg-background">
      <Toaster position="top-right" />
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-[1400px] items-center gap-4 px-6 py-3">
          <Link
            to="/"
            aria-label="miniSEED Studio: voltar aos projetos"
            className="flex h-11 w-11 shrink-0 items-center justify-center"
          >
            <img src="/logo-mark.png" alt="" className="h-full w-full object-contain" />
          </Link>
          <div className="flex-1 min-w-0">
            <Link
              to="/"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-3 w-3" />
              Projetos
            </Link>
            <div className="flex items-center gap-2">
              <h1 className="truncate text-base font-semibold">{project.name}</h1>
              <ProjectStatusBadge status={project.status} />
            </div>
          </div>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <div>
              <div className="text-[10px] uppercase tracking-wide">Arquivos</div>
              <div className="text-sm font-medium text-foreground">{project.fileCount}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide">Atualizado</div>
              <div className="text-sm font-medium text-foreground">
                {formatRelative(project.updatedAt)}
              </div>
            </div>
            <Button size="sm" variant="outline" onClick={() => setTab("processing")}>
              <Play className="mr-2 h-4 w-4" />
              Processar
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-6 py-6">
        <Tabs value={tab} onValueChange={setTab} className="space-y-6">
          <TabsList className="w-full justify-start overflow-x-auto">
            {TABS.map((t) => {
              const Icon = t.icon;
              return (
                <TabsTrigger key={t.value} value={t.value} className="gap-2">
                  <Icon className="h-4 w-4" />
                  {t.label}
                </TabsTrigger>
              );
            })}
          </TabsList>

          <TabsContent value="upload">
            <UploadTab
              projectId={projectId}
              onExtracted={() => {
                setRefreshKey((k) => k + 1);
                setTab("files");
              }}
            />
          </TabsContent>
          <TabsContent value="files">
            <FilesTab
              projectId={projectId}
              selection={selection}
              onSelectionChange={setSelection}
              onProcessSelection={handleProcessSelection}
              onFilesLoaded={handleFilesLoaded}
            />
          </TabsContent>
          <TabsContent value="inspection">
            <InspectionTab projectId={projectId} selection={selection} />
          </TabsContent>
          <TabsContent value="processing">
            <ProcessingTab
              key={processingViewKey}
              projectId={projectId}
              selection={selection}
              onJobChange={handleJobChange}
            />
          </TabsContent>
          <TabsContent value="results">
            <ResultsTab projectId={projectId} />
          </TabsContent>
          <TabsContent value="export">
            <ExportTab projectId={projectId} />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
