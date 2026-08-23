import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeft, Waves } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createProject } from "@/services/projects";

export const Route = createFileRoute("/projects/new")({
  head: () => ({
    meta: [
      { title: "Novo projeto — mSEED Navigator" },
      { name: "description", content: "Crie um novo projeto de análise microssísmica." },
    ],
  }),
  component: NewProjectPage,
});

function NewProjectPage() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [station, setStation] = useState("");
  const [channel, setChannel] = useState("");

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const p = createProject({ name, description, station, channel });
    navigate({ to: "/projects/$projectId", params: { projectId: p.id } });
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-6 py-4">
          <div className="flex h-12 w-16 items-center justify-center gap-1 rounded-md border bg-muted text-foreground shadow-sm">
            <Waves className="h-5 w-5 text-primary" aria-hidden="true" />
            <span className="text-sm font-semibold">MS</span>
          </div>
          <div className="flex-1">
            <Link to="/" className="text-xs text-muted-foreground hover:text-foreground">
              <ArrowLeft className="mr-1 inline h-3 w-3" />
              Voltar aos projetos
            </Link>
            <h1 className="text-lg font-semibold leading-tight">Novo projeto</h1>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-8">
        <Card>
          <CardHeader>
            <CardTitle>Detalhes do projeto</CardTitle>
            <CardDescription>
              Metadados básicos para identificar sua análise. Você pode editar depois.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="name">Nome do projeto *</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex.: Campanha Poço-A 2026-07"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Descrição</Label>
                <Textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Objetivos, área monitorada, período de aquisição..."
                  rows={3}
                />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="station">Estação (opcional)</Label>
                  <Input
                    id="station"
                    value={station}
                    onChange={(e) => setStation(e.target.value)}
                    placeholder="Ex.: INV01"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="channel">Canal (opcional)</Label>
                  <Input
                    id="channel"
                    value={channel}
                    onChange={(e) => setChannel(e.target.value)}
                    placeholder="Ex.: HHZ"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => navigate({ to: "/" })}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={!name.trim()}>
                  Criar projeto
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
