import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ProjectStatus, MseedFileStatus, JobStatus } from "@/services/types";

const projectMap: Record<ProjectStatus, { label: string; className: string }> = {
  created: { label: "Criado", className: "bg-muted text-muted-foreground" },
  uploading: { label: "Carregando", className: "bg-info/15 text-info border-info/20" },
  ready: { label: "Pronto", className: "bg-success/15 text-success border-success/20" },
  processing: { label: "Processando", className: "bg-warning/20 text-warning border-warning/30" },
  completed: { label: "Concluído", className: "bg-success/15 text-success border-success/20" },
  error: { label: "Erro", className: "bg-destructive/15 text-destructive border-destructive/20" },
};

const fileMap: Record<MseedFileStatus, { label: string; className: string }> = {
  pending: { label: "Pendente", className: "bg-muted text-muted-foreground" },
  read: { label: "Lido", className: "bg-info/15 text-info border-info/20" },
  processed: { label: "Processado", className: "bg-success/15 text-success border-success/20" },
  error: { label: "Erro", className: "bg-destructive/15 text-destructive border-destructive/20" },
};

const jobMap: Record<JobStatus, { label: string; className: string }> = {
  queued: { label: "Na fila", className: "bg-muted text-muted-foreground" },
  running: { label: "Executando", className: "bg-info/15 text-info border-info/20" },
  paused: { label: "Pausado", className: "bg-warning/20 text-warning border-warning/30" },
  completed: { label: "Concluído", className: "bg-success/15 text-success border-success/20" },
  canceled: { label: "Cancelado", className: "bg-muted text-muted-foreground" },
  error: { label: "Erro", className: "bg-destructive/15 text-destructive border-destructive/20" },
};

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  const cfg = projectMap[status] ?? projectMap.created;
  return (
    <Badge variant="outline" className={cn("font-medium", cfg.className)}>
      {cfg.label}
    </Badge>
  );
}

export function FileStatusBadge({ status }: { status: MseedFileStatus }) {
  const cfg = fileMap[status] ?? fileMap.pending;
  return (
    <Badge variant="outline" className={cn("font-medium", cfg.className)}>
      {cfg.label}
    </Badge>
  );
}

export function JobStatusBadge({ status }: { status: JobStatus }) {
  const cfg = jobMap[status];
  return (
    <Badge variant="outline" className={cn("font-medium", cfg.className)}>
      {cfg.label}
    </Badge>
  );
}
