import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppLayout } from "@/shared/components/AppLayout";
import { getTaskAgent } from "@/shared/lib/agents";
import type { PmProject } from "@/shared/lib/agents";
import { Card, CardContent } from "@/shared/components/ui/card";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/shared/components/ui/table";
import { Loader2, Plus, FolderKanban } from "lucide-react";
import { NewProjectDialog } from "../components/NewProjectDialog";

const STATUS_BADGE: Record<string, string> = {
  active: "bg-primary/15 text-primary",
  on_hold: "bg-secondary text-secondary-foreground",
  archived: "bg-muted text-muted-foreground",
};

export default function Projects() {
  const [projects, setProjects] = useState<PmProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const navigate = useNavigate();

  const load = async () => {
    setLoading(true);
    try {
      setProjects(await getTaskAgent().listProjects());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <AppLayout>
      <div className="space-y-6 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-serif text-2xl">Projects</h1>
            <p className="text-sm text-muted-foreground">Tasks and initiatives, tracked in-house.</p>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => setDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" /> New project
            </Button>
          </div>
        </div>

        <Card>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex justify-center py-10">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : projects.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No projects yet. Create your first one.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead className="hidden sm:table-cell">Description</TableHead>
                    <TableHead className="w-[110px]">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {projects.map((p) => (
                    <TableRow
                      key={p.id}
                      className="cursor-pointer"
                      onClick={() => navigate(`/projects/${p.id}`)}
                    >
                      <TableCell>
                        <div className="flex items-center gap-2 font-medium">
                          <FolderKanban className="h-4 w-4 shrink-0 text-primary" />
                          {p.name}
                        </div>
                      </TableCell>
                      <TableCell className="hidden max-w-md truncate text-sm text-muted-foreground sm:table-cell">
                        {p.description || "—"}
                      </TableCell>
                      <TableCell>
                        <Badge className={STATUS_BADGE[p.status] || ""} variant="secondary">
                          {p.status.replace("_", " ")}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <NewProjectDialog open={dialogOpen} onOpenChange={setDialogOpen} onCreated={(id) => navigate(`/projects/${id}`)} />
    </AppLayout>
  );
}
