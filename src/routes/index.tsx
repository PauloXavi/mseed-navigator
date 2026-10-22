import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Activity, FileArchive, Filter, Plus, Trash2, Waves } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ProjectStatusBadge } from "@/components/status-badges";
import { deleteProject, listProjects } from "@/services/projects";
import type { Project, ProjectStatus } from "@/services/types";
import { formatRelative } from "@/lib/format";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Projetos — miniSEED Studio" },
      {
        name: "description",
        content:
          "Dashboard de projetos microssísmicos: crie, acompanhe e continue análises MiniSEED.",
      },
    ],
  }),
  component: DashboardPage,
});

const STATUSES: { value: ProjectStatus | "all"; label: string }[] = [
  { value: "all", label: "Todos" },
  { value: "created", label: "Criado" },
  { value: "uploading", label: "Carregando" },
  { value: "ready", label: "Pronto" },
  { value: "processing", label: "Processando" },
  { value: "completed", label: "Concluído" },
  { value: "error", label: "Erro" },
];

function DashboardPage() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<ProjectStatus | "all">("all");

  useEffect(() => {
    setProjects(listProjects());
  }, []);

  async function handleDeleteProject(projectId: string) {
    await fetch(`/api/projects/${projectId}`, { method: "DELETE" }).catch(() => undefined);
    deleteProject(projectId);
    setProjects(listProjects());
  }

  const filtered = useMemo(() => {
    return projects.filter((p) => {
      if (status !== "all" && p.status !== status) return false;
      if (query && !p.name.toLowerCase().includes(query.toLowerCase())) return false;
      return true;
    });
  }, [projects, query, status]);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <img src="/logo-mark.png" alt="" className="h-12 w-12 shrink-0 object-contain" />
            <div>
              <h1 className="text-lg font-semibold leading-tight">miniSEED Studio</h1>
              <p className="text-xs text-muted-foreground">Análise de dados microssísmicos</p>
            </div>
          </div>
          <Button onClick={() => navigate({ to: "/projects/new" })}>
            <Plus className="mr-2 h-4 w-4" />
            Novo projeto
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-64">
            <Filter className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar projetos..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={status} onValueChange={(v) => setStatus(v as ProjectStatus | "all")}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUSES.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {filtered.length === 0 ? (
          <EmptyState hasAny={projects.length > 0} />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filtered.map((p) => (
              <ProjectCard key={p.id} project={p} onDelete={handleDeleteProject} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function ProjectCard({
  project,
  onDelete,
}: {
  project: Project;
  onDelete: (projectId: string) => void;
}) {
  return (
    <Card className="h-full transition-colors hover:border-primary/50">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <Link to="/projects/$projectId" params={{ projectId: project.id }} className="block">
              <CardTitle className="truncate text-base leading-tight hover:text-primary">
                {project.name}
              </CardTitle>
            </Link>
            {project.description && (
              <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
                {project.description}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <ProjectStatusBadge status={project.status} />
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  aria-label={`Excluir projeto ${project.name}`}
                  title="Excluir projeto"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Excluir projeto?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Esta ação remove o projeto <b>{project.name}</b> e os dados locais associados a
                    ele. Não é possível desfazer.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={() => onDelete(project.id)}
                  >
                    Excluir
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </CardHeader>
      <Link to="/projects/$projectId" params={{ projectId: project.id }} className="block">
        <CardContent className="grid grid-cols-3 gap-3 text-xs">
          <Metric
            icon={<FileArchive className="h-3.5 w-3.5" />}
            label="Arquivos"
            value={project.fileCount}
          />
          <Metric
            icon={<Activity className="h-3.5 w-3.5" />}
            label="Atualizado"
            value={formatRelative(project.updatedAt)}
          />
          <Metric
            label="Último proc."
            value={project.lastProcessedAt ? formatRelative(project.lastProcessedAt) : "—"}
          />
        </CardContent>
      </Link>
    </Card>
  );
}

function Metric({
  icon,
  label,
  value,
}: {
  icon?: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-1 text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-0.5 text-sm font-medium text-foreground">{value}</div>
    </div>
  );
}

function EmptyState({ hasAny }: { hasAny: boolean }) {
  const navigate = useNavigate();
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <Waves className="h-6 w-6 text-muted-foreground" />
        </div>
        <div>
          <h3 className="text-sm font-semibold">
            {hasAny ? "Nenhum projeto corresponde aos filtros" : "Nenhum projeto ainda"}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {hasAny
              ? "Ajuste a busca ou o status para encontrar seus projetos."
              : "Crie seu primeiro projeto para começar a analisar dados MiniSEED."}
          </p>
        </div>
        {!hasAny && (
          <Button onClick={() => navigate({ to: "/projects/new" })}>
            <Plus className="mr-2 h-4 w-4" />
            Criar projeto
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
