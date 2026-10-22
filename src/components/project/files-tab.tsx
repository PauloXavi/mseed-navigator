import { useEffect, useMemo, useState } from "react";
import { Eye, FileText, Play, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import { HintLabel } from "@/components/info-hint";
import { FileStatusBadge } from "@/components/status-badges";
import { useProjectFiles } from "@/hooks/use-project-files";
import { readMiniSeedMetadata } from "@/services/files";
import type { MseedFile, MseedFileStatus } from "@/services/types";
import { formatBytes, formatDuration, formatUtc } from "@/lib/format";

interface Props {
  projectId: string;
  selection: string[];
  onSelectionChange: (ids: string[]) => void;
  onProcessSelection: (files: { fileIds: string[]; fileNames: string[] }) => void;
  onFilesLoaded?: (count: number) => void;
}

export function FilesTab({
  projectId,
  selection,
  onSelectionChange,
  onProcessSelection,
  onFilesLoaded,
}: Props) {
  const { files, setFiles, loading } = useProjectFiles(projectId);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<MseedFileStatus | "all">("all");
  const [channel, setChannel] = useState<string>("all");

  useEffect(() => {
    if (!loading) onFilesLoaded?.(files.length);
  }, [files.length, loading, onFilesLoaded]);

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
    // Updates the status in place; replacing the list with the locally stored one would
    // drop the files indexed by the backend.
    await readMiniSeedMetadata(projectId, selection);
    setFiles((current) =>
      current.map((file) =>
        selection.includes(file.id) && file.status === "pending"
          ? { ...file, status: "read" }
          : file,
      ),
    );
  }

  function handleProcess() {
    const selected = files.filter((file) => selection.includes(file.id));
    onProcessSelection({
      fileIds: selected.map((file) => file.id),
      fileNames: selected.map((file) => file.fileName),
    });
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
          <CardTitle>
            <HintLabel term="miniseed">Arquivos MiniSEED</HintLabel>
          </CardTitle>
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
          <MetadataDialog files={files.filter((file) => selection.includes(file.id))} />
          <Button size="sm" disabled={selection.length === 0} onClick={handleProcess}>
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
                <TableHead>
                  <HintLabel term="network">Rede</HintLabel>
                </TableHead>
                <TableHead>
                  <HintLabel term="station">Estação</HintLabel>
                </TableHead>
                <TableHead>
                  <HintLabel term="channel">Canal</HintLabel>
                </TableHead>
                <TableHead>Início UTC</TableHead>
                <TableHead>Duração</TableHead>
                <TableHead>
                  <HintLabel term="samplingRate">Hz</HintLabel>
                </TableHead>
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

function MetadataDialog({ files }: { files: MseedFile[] }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" disabled={files.length === 0}>
          <FileText className="mr-2 h-4 w-4" />
          Ver metadados
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Metadados MiniSEED</DialogTitle>
          <DialogDescription>
            Cabeçalho e estatísticas de amplitude (contagens) dos arquivos selecionados.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Arquivo</TableHead>
                <TableHead>
                  <HintLabel term="trace">Trace</HintLabel>
                </TableHead>
                <TableHead>Início / fim UTC</TableHead>
                <TableHead>
                  <HintLabel term="samplingRate">Hz</HintLabel>
                </TableHead>
                <TableHead>N pontos</TableHead>
                <TableHead>Mín / Máx</TableHead>
                <TableHead>Média</TableHead>
                <TableHead>Std</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {files.map((f) => (
                <TableRow key={f.id}>
                  <TableCell className="font-mono text-xs">{f.fileName}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {[f.network, f.station, f.location, f.channel].join(".")}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {formatUtc(f.starttimeUtc)}
                    <br />
                    {formatUtc(f.endtimeUtc)}
                  </TableCell>
                  <TableCell>{f.samplingRateHz}</TableCell>
                  <TableCell>{f.npts.toLocaleString()}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {formatStat(f.min)} / {formatStat(f.max)}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{formatStat(f.mean)}</TableCell>
                  <TableCell className="font-mono text-xs">{formatStat(f.std)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function formatStat(value: number | undefined) {
  return Number.isFinite(value)
    ? (value as number).toLocaleString(undefined, { maximumFractionDigits: 1 })
    : "—";
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
