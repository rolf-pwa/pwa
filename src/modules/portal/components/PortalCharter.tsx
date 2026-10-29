import { Card, CardContent } from "@/shared/components/ui/card";
import { ScrollText, ExternalLink } from "lucide-react";

interface Props {
  charterUrl?: string | null;
}

export function PortalCharter({ charterUrl }: Props) {
  if (!charterUrl) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-10 text-center">
          <ScrollText className="h-10 w-10 text-muted-foreground/40 mb-3" />
          <h3 className="text-sm font-semibold text-foreground font-serif">
            Sovereignty Charter
          </h3>
          <p className="text-xs text-muted-foreground mt-1.5 max-w-xs">
            Your charter document has not been linked yet. Your Family CFO can add a Google Drive link now and switch it to the permanent document source later.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <a
      href={charterUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2 rounded-md border border-border px-3 py-2.5 text-sm font-medium text-foreground hover:bg-muted/50 transition-colors"
    >
      <ScrollText className="h-4 w-4" />
      Sovereignty Charter
      <ExternalLink className="ml-auto h-3 w-3 opacity-40" />
    </a>
  );
}
