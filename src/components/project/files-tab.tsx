import { useEffect, useMemo, useState } from "react";
import { Eye, FileText, Play, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FileStatusBadge } from "@/components/status-badges";
import { listFiles, readMiniSeedMetadata } from "@/services/files";
import type { MseedFile, MseedFileStatus } from "@/services/types";
import { formatBytes, formatDuration, formatUtc } from "@/lib/format";

interface Props {
  projectId: string;
  selection: string[];
  onSelectionChange: (ids: string[]) => void;
  onProcessSelection: (ids: string[]) => void;
  onFilesLoaded?: (count: number) => void;
}

export function FilesTab({
  projectId,
  selection,
  onSelectionChange,
  onProcessSelection,
  onFilesLoaded,
}: Props) {
  const [files, setFiles] = useState<MseedFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<MseedFileStatus | "all">("all");
  const [channel, setChannel] = useState<string>("all");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    fetch(`/api/files/${projectId}`)
      .then(async (response) => {
        const payload = (await response.json()) as { files?: MseedFile[]; error?: string };
        if (!response.ok) throw new Error(payload.error ?? "Falha ao carregar arquivos reais");
        return payload.files ?? [];
      })
      .then((realFiles) => {
        if (cancelled) return;
        setFiles(realFiles);
        onFilesLoaded?.(realFiles.length);
      })
      .catch(() => {
        if (cancelled) return;
        const localFiles = listFiles(projectId);
        setFiles(localFiles);
        onFilesLoaded?.(localFiles.length);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [onFilesLoaded, projectId]);

  useEffect(() => {
    if (files.length === 0 || selection.length === 0) return;
    const validIds = new Set(files.map((file) => file.id));
    const validSelection = selection.filter((id) => validIds.has(id));
    if (validSelection.length !== selection.length) onSelectionChange(validSelection);
  }, [files, onSelectionChange, selection]);

  const channels = useMemo(() => Array.from(new Set(files.map((f) => f.channel))).sort(), [files]);

  const filtered = useMemo(() => {
    return files.filter((f) => {
      if (status !== "all" && f.status !== status) return false;
      if (channel !== "all" && f.channel !== channel) return false;
      if (query && !f.fileName.toLowerCase().includes(query.toLowerCase())) return false;
      return true;
    });
  }, [files, query, status, channel]);

  const allSelected = filtered.length > 0 && filtered.every((f) => selection.includes(f.id));

  function toggleAll() {
    if (allSelected)
      onSelectionChange(selection.filter((id) => !filtered.some((f) => f.id === id)));
    else onSelectionChange(Array.from(new Set([...selection, ...filtered.map((f) => f.id)])));
  }

  function toggleOne(id: string) {
    onSelectionChange(
      selection.includes(id) ? selection.filter((s) => s !== id) : [...selection, id],
    );
  }

  async function handleRead() {
    await readMiniSeedMetadata(projectId, selection);
    setFiles(listFiles(projectId));
  }

  if (loading) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-center">
          <FileText className="h-8 w-8 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Carregando arquivos reais</h3>
          <p className="text-sm text-muted-foreground">
            Lendo os metadados gerados pelo backend Python.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (files.length === 0) {
    return <EmptyFiles />;
  }

  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>Arquivos MiniSEED</CardTitle>
          <div className="text-xs text-muted-foreground">
            {selection.length} de {files.length} selecionados
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-64 flex-1">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={status} onValueChange={(v) => setStatus(v as MseedFileStatus | "all")}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos status</SelectItem>
              <SelectItem value="pending">Pendente</SelectItem>
              <SelectItem value="read">Lido</SelectItem>
              <SelectItem value="processed">Processado</SelectItem>
              <SelectItem value="error">Erro</SelectItem>
            </SelectContent>
          </Select>
          <Select value={channel} onValueChange={setChannel}>
            <SelectTrigger className="w-32">
              <SelectValue placeholder="Canal" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos canais</SelectItem>
              {channels.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant="outline"
            disabled={selection.length === 0}
            onClick={handleRead}
          >
            <Eye className="mr-2 h-4 w-4" />
            Ler selecionados
          </Button>
          <Button size="sm" variant="outline" disabled={selection.length === 0}>
            <FileText className="mr-2 h-4 w-4" />
            Ver metadados
          </Button>
          <Button
            size="sm"
            disabled={selection.length === 0}
            onClick={() => onProcessSelection(selection)}
          >
            <Play className="mr-2 h-4 w-4" />
            Processar seleção
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-hidden rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">
                  <Checkbox checked={allSelected} onCheckedChange={toggleAll} />
                </TableHead>
                <TableHead>Nome</TableHead>
                <TableHead>Rede</TableHead>
                <TableHead>Estação</TableHead>
                <TableHead>Canal</TableHead>
                <TableHead>Início UTC</TableHead>
                <TableHead>Duração</TableHead>
                <TableHead>Hz</TableHead>
                <TableHead>Tamanho</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((f) => (
                <TableRow key={f.id} className="cursor-pointer" onClick={() => toggleOne(f.id)}>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={selection.includes(f.id)}
                      onCheckedChange={() => toggleOne(f.id)}
                    />
                  </TableCell>
                  <TableCell className="font-mono text-xs">{f.fileName}</TableCell>
                  <TableCell>{f.network}</TableCell>
                  <TableCell>{f.station}</TableCell>
                  <TableCell>{f.channel}</TableCell>
                  <TableCell className="font-mono text-xs">{formatUtc(f.starttimeUtc)}</TableCell>
                  <TableCell>{formatDuration(f.durationS)}</TableCell>
                  <TableCell>{f.samplingRateHz}</TableCell>
                  <TableCell>{formatBytes(f.sizeBytes)}</TableCell>
                  <TableCell>
                    <FileStatusBadge status={f.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyFiles() {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-center">
        <FileText className="h-8 w-8 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Nenhum arquivo indexado</h3>
        <p className="text-sm text-muted-foreground">
          Faça upload de um arquivo .zip na aba <b>Upload</b> para começar.
        </p>
      </CardContent>
    </Card>
  );
}
