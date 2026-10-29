import { useState } from "react";
import { supabase } from "@/shared/integrations/supabase/client";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Textarea } from "@/shared/components/ui/textarea";
import { Switch } from "@/shared/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/shared/components/ui/dialog";
import { Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { publicPayUrl, bookingEmbedSnippet } from "../lib/booking-links";


export interface ServiceRecord {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  price: number;
  currency: string;
  tax_rate?: number | null;
  duration_minutes: number | null;
  is_active: boolean;
  square_catalog_object_id: string | null;
  square_sync_status: string;
  square_sync_error: string | null;
  requires_prepayment?: boolean | null;
  booking_url?: string | null;
  slug?: string | null;
  triggers_onboarding?: boolean | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  service: ServiceRecord | null;
  onSaved: () => void;
}

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

export function ServiceDialog({ open, onOpenChange, service, onSaved }: Props) {
  const [name, setName] = useState(service?.name ?? "");
  const [description, setDescription] = useState(service?.description ?? "");
  const [category, setCategory] = useState(service?.category ?? "");
  const [price, setPrice] = useState(service ? String(service.price) : "");
  const [duration, setDuration] = useState(service?.duration_minutes ? String(service.duration_minutes) : "");
  const [taxRate, setTaxRate] = useState(service ? String(service.tax_rate ?? 0) : "5");
  const [isActive, setIsActive] = useState(service?.is_active ?? true);
  const [requiresPrepayment, setRequiresPrepayment] = useState(service?.requires_prepayment ?? true);
  const [triggersOnboarding, setTriggersOnboarding] = useState(service?.triggers_onboarding ?? false);
  const [bookingUrl, setBookingUrl] = useState(service?.booking_url ?? "");
  const [slug, setSlug] = useState(service?.slug ?? "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!name.trim()) {
      toast.error("Give the service a name.");
      return;
    }
    setSaving(true);
    const payload = {
      name: name.trim(),
      description: description.trim() || null,
      category: category.trim() || null,
      price: Number(price || 0),
      duration_minutes: duration ? Number(duration) : null,
      tax_rate: Number(taxRate || 0),
      is_active: isActive,
      requires_prepayment: requiresPrepayment,
      triggers_onboarding: triggersOnboarding,
      booking_url: bookingUrl.trim() || null,
      slug: slugify(slug || name) || null,
    };

    const { error } = service
      ? await supabase.from("services" as any).update(payload).eq("id", service.id)
      : await supabase.from("services" as any).insert(payload);

    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(service ? "Service updated" : "Service created");
    onSaved();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{service ? "Edit service" : "New service"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="svc-name">Name</Label>
            <Input id="svc-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Transition Survey" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="svc-desc">Description</Label>
            <Textarea
              id="svc-desc"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What the client receives"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="svc-cat">Category</Label>
              <Input id="svc-cat" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Consulting" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="svc-price">Price (CAD)</Label>
              <Input
                id="svc-price"
                type="number"
                min="0"
                step="0.01"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="svc-tax">Sales tax rate (%)</Label>
            <Input
              id="svc-tax"
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={taxRate}
              onChange={(e) => setTaxRate(e.target.value)}
              placeholder="5"
            />
            <p className="text-xs text-muted-foreground">
              Use 5 for GST. Applied automatically to invoice lines using this service.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="svc-dur">Duration (minutes)</Label>
              <Input
                id="svc-dur"
                type="number"
                min="0"
                step="5"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                placeholder="60"
              />
            </div>
            <div className="flex items-center gap-3 pt-7">
              <Switch id="svc-active" checked={isActive} onCheckedChange={setIsActive} />
              <Label htmlFor="svc-active">Bookable</Label>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Switch id="svc-prepay" checked={requiresPrepayment} onCheckedChange={setRequiresPrepayment} />
            <Label htmlFor="svc-prepay">Require payment before booking</Label>
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <Switch id="svc-onboarding" checked={triggersOnboarding} onCheckedChange={setTriggersOnboarding} />
              <Label htmlFor="svc-onboarding">Paying this invoice enrolls the client in guided onboarding</Label>
            </div>
            <p className="text-xs text-muted-foreground">
              When an invoice with this service is paid, the client is matched or created in the CRM and their
              onboarding portal is turned on automatically, same as paying through Checkout.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="svc-booking-url">Scheduling link</Label>
            <Input
              id="svc-booking-url"
              value={bookingUrl}
              onChange={(e) => setBookingUrl(e.target.value)}
              placeholder="https://calendar.app.google/..."
            />
            <p className="text-xs text-muted-foreground">
              Where clients pick their time after paying. Leave blank to schedule manually.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="svc-slug">Booking link handle</Label>
            <div className="flex gap-2">
              <Input
                id="svc-slug"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder={slugify(name) || "sovereignty-audit-personal"}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                title="Copy direct payment link"
                onClick={() => {
                  const handle = slugify(slug || name);
                  if (!handle) return;
                  navigator.clipboard.writeText(publicPayUrl(handle));
                  toast.success("Direct payment link copied");
                }}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Direct payment link: {publicPayUrl(slugify(slug || name) || "handle")}, goes straight to Square checkout.
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => {
                const handle = slugify(slug || name);
                if (!handle) return;
                navigator.clipboard.writeText(bookingEmbedSnippet(handle, window.location.origin));
                toast.success("Button code copied, paste into your marketing site");
              }}
            >
              Copy button code for marketing site
            </Button>

          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {service ? "Save changes" : "Create service"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
