import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/shared/integrations/supabase/client";
import { useMeetingTypes } from "@/shared/hooks/useMeetingTypes";
import { moveType, parseBookingLink, type MeetingType } from "@/shared/lib/meetingTypes";
import { Button } from "@/shared/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Switch } from "@/shared/components/ui/switch";

/** Add, rename, reorder, hide or remove the meeting types people can book. Changes apply immediately, with no deploy. */
export function MeetingTypesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const { data: types = [] } = useMeetingTypes();
  const [form, setForm] = useState({ label: "", minutes: "60", link: "" });
  const [busy, setBusy] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ["meeting-types"] });
  const fail = (what: string, e: unknown) => toast.error(`${what}: ${e instanceof Error ? e.message : (e as { message?: string })?.message ?? String(e)}`);

  const patch = async (id: string, values: Partial<MeetingType>) => {
    const { error } = await supabase.from("meeting_types").update(values as never).eq("id", id);
    if (error) return fail("Not saved", error);
    refresh();
  };

  const move = async (id: string, dir: -1 | 1) => {
    const next = moveType(types, id, dir);
    try {
      await Promise.all(next.filter((t) => t.sort_order !== types.find((o) => o.id === t.id)?.sort_order).map((t) => supabase.from("meeting_types").update({ sort_order: t.sort_order } as never).eq("id", t.id)));
      refresh();
    } catch (e) { fail("Not saved", e); }
  };

  const remove = async (t: MeetingType) => {
    if (!window.confirm(`Remove "${t.label}"? Anyone using its link outside the app is not affected.`)) return;
    const { error } = await supabase.from("meeting_types").delete().eq("id", t.id);
    if (error) return fail("Couldn't remove", error);
    refresh();
  };

  const add = async () => {
    const parsed = parseBookingLink(form.link);
    if (!parsed) { toast.error("Paste the booking link from Google Calendar (calendar.google.com/calendar/appointments/schedules/… or calendar.app.google/…)."); return; }
    setBusy(true);
    const { error } = await supabase.from("meeting_types").insert({
      label: form.label.trim(), minutes: Number(form.minutes) || null, url: parsed.url, embed_url: parsed.embed_url,
      sort_order: types.length ? Math.max(...types.map((t) => t.sort_order)) + 1 : 0, staff_visible: true, client_visible: false,
    } as never);
    setBusy(false);
    if (error) return fail("Couldn't add", error);
    setForm({ label: "", minutes: "60", link: "" });
    refresh();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Meeting types</DialogTitle>
          <DialogDescription>
            The types you can book from a contact, and the ones clients see in their portal. Add a type by pasting its booking link from Google Calendar.
            Renaming a type in Google doesn't rename it here, and deleting one in Google leaves its link broken until you remove it here.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1">
          <div className="hidden grid-cols-[1fr_4rem_3.5rem_3.5rem_3.5rem_5.5rem] gap-2 px-1 text-[10px] uppercase tracking-wide text-muted-foreground md:grid">
            <span>Name</span><span>Min</span><span className="text-center">Staff</span><span className="text-center">Clients</span><span className="text-center">On</span><span />
          </div>
          {types.map((t, i) => (
            <div key={t.id} className="grid grid-cols-1 items-center gap-2 border-b py-1.5 md:grid-cols-[1fr_4rem_3.5rem_3.5rem_3.5rem_5.5rem]">
              <div className="min-w-0">
                <Input className="h-8" defaultValue={t.label} onBlur={(e) => e.target.value.trim() && e.target.value !== t.label && patch(t.id, { label: e.target.value.trim() })} />
                {t.client_visible && (
                  <Input className="mt-1 h-7 text-xs" placeholder="Name clients see (optional)" defaultValue={t.client_label ?? ""} onBlur={(e) => (e.target.value.trim() || null) !== t.client_label && patch(t.id, { client_label: e.target.value.trim() || null })} />
                )}
                <a href={t.url} target="_blank" rel="noopener noreferrer" className="block truncate text-[10px] text-muted-foreground hover:underline">{t.url}</a>
              </div>
              <Input className="h-8" type="number" defaultValue={t.minutes ?? ""} onBlur={(e) => Number(e.target.value) !== (t.minutes ?? 0) && patch(t.id, { minutes: Number(e.target.value) || null })} />
              <div className="flex justify-center"><Switch checked={t.staff_visible} onCheckedChange={(v) => patch(t.id, { staff_visible: v })} /></div>
              <div className="flex justify-center"><Switch checked={t.client_visible} onCheckedChange={(v) => patch(t.id, { client_visible: v })} /></div>
              <div className="flex justify-center"><Switch checked={t.active} onCheckedChange={(v) => patch(t.id, { active: v })} /></div>
              <div className="flex justify-end gap-0.5">
                <Button size="icon" variant="ghost" className="h-7 w-7" disabled={i === 0} onClick={() => move(t.id, -1)}><ArrowUp className="h-3.5 w-3.5" /></Button>
                <Button size="icon" variant="ghost" className="h-7 w-7" disabled={i === types.length - 1} onClick={() => move(t.id, 1)}><ArrowDown className="h-3.5 w-3.5" /></Button>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => remove(t)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-2 rounded-md border p-3">
          <p className="text-sm font-medium">Add a meeting type</p>
          <div className="grid gap-2 md:grid-cols-[1fr_5rem]">
            <div className="space-y-1"><Label className="text-xs">Name</Label><Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} /></div>
            <div className="space-y-1"><Label className="text-xs">Minutes</Label><Input type="number" value={form.minutes} onChange={(e) => setForm({ ...form, minutes: e.target.value })} /></div>
          </div>
          <div className="space-y-1"><Label className="text-xs">Booking link</Label><Input placeholder="https://calendar.google.com/calendar/appointments/schedules/…" value={form.link} onChange={(e) => setForm({ ...form, link: e.target.value })} /></div>
          <Button size="sm" onClick={add} disabled={busy || !form.label.trim() || !form.link.trim()}><Plus className="mr-1 h-3.5 w-3.5" /> Add</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
