import { usePortalPwa } from "../hooks/usePortalPwa";
import { PortalDocumentScanner } from "./PortalDocumentScanner";
import { PortalPushToggle } from "./PortalPushToggle";

/** V2 mobile extras for the client portal sidebar. Renders nothing for V1 households. */
export function PortalMobileTools({ portalToken, householdId }: { portalToken: string; householdId: string | null | undefined }) {
  const pwa = usePortalPwa(portalToken);
  if (!pwa.enabled) return null;
  return (
    <>
      <PortalDocumentScanner portalToken={portalToken} householdId={householdId} />
      <PortalPushToggle pwa={pwa} />
    </>
  );
}
