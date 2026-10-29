import { useEffect, useState } from "react";
import { AppLayout } from "@/shared/components/AppLayout";
import { supabase } from "@/shared/integrations/supabase/client";
import { getInvoiceAgent } from "@/shared/lib/agents";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/shared/components/ui/table";
import {
  Loader2,
  Plus,
  Pencil,
  RefreshCw,
  CloudUpload,
  AlertTriangle,
  Link as LinkIcon,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { ServiceDialog, type ServiceRecord } from "../components/ServiceDialog";
import { BookingsPanel } from "../components/BookingsPanel";
import { formatMoney } from "../lib/money";
import { publicPayUrl } from "../lib/booking-links";


const SYNC_LABELS: Record<string, string> = {
  not_synced: "Not on Square",
  synced: "On Square",
  error: "Sync error",
};

export default function Services() {
  const [services, setServices] = useState<ServiceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ServiceRecord | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [squareReady, setSquareReady] = useState<boolean | null>(null);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from("services" as any).select("*").order("name");
    setServices((data as any) || []);
    setLoading(false);
  };

  useEffect(() => {
    load();
    getInvoiceAgent()
      .getStatus()
      .then((s) => setSquareReady(s.configured))
      .catch(() => setSquareReady(false));
  }, []);

  const sync = async (service: ServiceRecord) => {
    setSyncingId(service.id);
    try {
      await getInvoiceAgent().syncService(service.id);
      toast.success(`${service.name} synced to Square`);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sync failed");
      load();
    } finally {
      setSyncingId(null);
    }
  };

  const remove = async (service: ServiceRecord) => {
    if (
      !window.confirm(
        `Delete "${service.name}" permanently? It will also be removed from your Square catalog. This can't be undone.`,
      )
    )
      return;
    setSyncingId(service.id);
    try {
      await getInvoiceAgent().deleteService(service.id);
      toast.success(`${service.name} deleted`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setSyncingId(null);
      load();
    }
  };

  return (
    <AppLayout>
      <div className="space-y-6 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-serif text-2xl">Services</h1>
            <p className="text-sm text-muted-foreground">
              Your service catalog. Synced items are bookable and invoiceable through Square.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={load}>
              <RefreshCw className="mr-2 h-4 w-4" /> Refresh
            </Button>
            <Button
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
            >
              <Plus className="mr-2 h-4 w-4" /> New service
            </Button>
          </div>
        </div>

        {squareReady === false && (
          <Card className="border-accent/40">
            <CardContent className="flex items-start gap-3 py-4 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 text-accent" />
              <span>
                Square isn't connected yet. You can build the catalog now, syncing and invoice sending activate once
                the Square access token and location are saved.
              </span>
            </CardContent>
          </Card>
        )}

        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">Catalog</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex justify-center py-10">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : services.length === 0 ? (
                <p className="py-6 text-sm text-muted-foreground">No services yet. Create your first one.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Service</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead className="text-right">Price</TableHead>
                      <TableHead>Duration</TableHead>
                      <TableHead>Square</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {services.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell>
                          <div className="font-medium">{s.name}</div>
                          {s.description && (
                            <div className="max-w-md truncate text-xs text-muted-foreground">{s.description}</div>
                          )}
                          {!s.is_active && (
                            <Badge variant="secondary" className="mt-1">
                              Inactive
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{s.category || "—"}</TableCell>
                        <TableCell className="text-right">{formatMoney(s.price, s.currency)}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {s.duration_minutes ? `${s.duration_minutes} min` : "—"}
                        </TableCell>
                        <TableCell>
                          <Badge
                            className={
                              s.square_sync_status === "synced"
                                ? "bg-primary text-primary-foreground"
                                : s.square_sync_status === "error"
                                  ? "bg-destructive text-destructive-foreground"
                                  : "bg-secondary text-secondary-foreground"
                            }
                          >
                            {SYNC_LABELS[s.square_sync_status] || s.square_sync_status}
                          </Badge>
                          {s.square_sync_error && (
                            <div className="mt-1 max-w-[220px] text-xs text-destructive">{s.square_sync_error}</div>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => {
                                setEditing(s);
                                setDialogOpen(true);
                              }}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Copy direct payment link"
                              onClick={() => {
                                const handle = s.slug || s.id;
                                navigator.clipboard.writeText(publicPayUrl(handle));
                                toast.success("Direct payment link copied");
                              }}
                            >

                              <LinkIcon className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              disabled={syncingId === s.id}
                              onClick={() => sync(s)}
                              title="Sync to Square"
                            >
                              {syncingId === s.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <CloudUpload className="h-4 w-4" />
                              )}
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Delete service"
                              disabled={syncingId === s.id}
                              onClick={() => remove(s)}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <BookingsPanel />
        </div>
      </div>

      <ServiceDialog
        key={editing?.id || "new"}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        service={editing}
        onSaved={load}
      />
    </AppLayout>
  );
}
