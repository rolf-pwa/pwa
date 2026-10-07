import type { CSSProperties, ReactNode } from "react";
import pwLogoWhite from "@/assets/prosperwise-logo-white.png";

// Shared look of ProsperWise's printed documents (Sovereignty Review, Governance Audit): A4 portrait, a dark brand
// sidebar on the first page, the same type, the tan rule and the tan footer bar. Print is A4 with no margin so the
// sidebar and footer bleed to the edge, the same as the Stabilization Map.

export const DOC_FONT = "'DM Sans', sans-serif";
export const DOC_SERIF = "'Cormorant Garamond', serif";
export const DOC_TAN = "#a37c58";

export const colLabel: CSSProperties = { fontSize: "6.5pt", letterSpacing: ".1em", textTransform: "uppercase", color: "#94a3b8", marginBottom: "2mm", paddingBottom: "1.5mm", borderBottom: "1px solid #e2e8f0" };
export const colText: CSSProperties = { fontSize: "8.5pt", color: "#334155", lineHeight: 1.4 };

export function DocPrintStyles() {
  return (
    <style>{`
      @media print {
        @page { size: A4 portrait; margin: 0; }
        body { background: white !important; }
        .stab-doc, .stab-doc-page2 { box-shadow: none !important; }
      }
    `}</style>
  );
}

/** The dark brand column down the left of a document's first page. */
export function DocSidebar() {
  return (
    <aside style={{ width: "60mm", backgroundColor: "#1e293b", color: "#fff", padding: "10mm 6mm", display: "flex", flexDirection: "column", gap: "6mm", flexShrink: 0 }}>
      <div>
        <img src={pwLogoWhite} alt="ProsperWise" style={{ width: "42mm", height: "auto", display: "block", marginBottom: "3mm" }} />
        <div style={{ fontSize: "9pt", fontWeight: 300, color: "rgba(255,255,255,.5)", letterSpacing: ".08em", textTransform: "uppercase" }}>Sovereignty Operating System™</div>
      </div>
      <hr style={{ border: "none", borderTop: "1px solid rgba(255,255,255,.18)" }} />
      <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "16pt", fontWeight: 300, lineHeight: 1.3 }}>
        Don't Invest. <em style={{ fontStyle: "italic", color: "rgba(255,255,255,.7)" }}>Integrate.</em>
      </div>
      <hr style={{ border: "none", borderTop: "1px solid rgba(255,255,255,.18)" }} />
      <div>
        <div style={{ fontSize: "6.5pt", letterSpacing: ".12em", textTransform: "uppercase", color: "rgba(255,255,255,.4)", marginBottom: "2mm" }}>Our Process</div>
        {[["1 · Stabilization", "Secure your funds, lower the noise, buy time to think clearly."], ["2 · Charter", "Define your governing constitution and liquidity rules."], ["3 · Integration", "Deploy capital, coordinate your team, silence the noise."]].map(([t, d]) => (
          <div key={t} style={{ marginBottom: "3mm" }}>
            <strong style={{ fontSize: "8.5pt", fontWeight: 600 }}>{t}</strong>
            <p style={{ fontSize: "7.5pt", color: "rgba(255,255,255,.5)", marginTop: "1pt" }}>{d}</p>
          </div>
        ))}
      </div>
      <hr style={{ border: "none", borderTop: "1px solid rgba(255,255,255,.18)" }} />
      <div>
        <strong style={{ display: "block", fontSize: "8.5pt", fontWeight: 600 }}>Prepared By:<br />Rolf Issler, BMgt, CLU</strong>
        <p style={{ fontSize: "7.5pt", color: "rgba(255,255,255,.5)", marginTop: "1pt" }}>Sudden Wealth Specialist, Family CFO</p>
      </div>
      <div style={{ marginTop: "auto", paddingTop: "4mm" }}>
        <div style={{ fontSize: "6.5pt", color: "rgba(255,255,255,.4)", lineHeight: 1.5 }}>
          © {new Date().getFullYear()} ProsperWise Advisors · www.prosperwise.ca<br />
          Data residency: Canada. All client data stored and processed in Canadian data centers in compliance with PIPEDA.
        </div>
      </div>
    </aside>
  );
}

/** Pages after the first: the same A4 sheet, header and tan footer bar. */
export function DocPage({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  return (
    <div
      className="stab-doc-page2 bg-white shadow-lg print:shadow-none mt-6 print:mt-0"
      style={{ width: "210mm", minHeight: "297mm", padding: "12mm", display: "flex", flexDirection: "column", gap: "5mm", fontFamily: DOC_FONT, color: "#334155", pageBreakBefore: "always", breakBefore: "page" }}
    >
      {children}
      {footer && (
        <div style={{ background: DOC_TAN, color: "#fff", margin: "auto -12mm 0 -12mm", padding: "3mm 12mm" }}>
          <div style={{ fontSize: "7pt", fontWeight: 400, lineHeight: 1.5 }}>{footer}</div>
        </div>
      )}
    </div>
  );
}

export function DocPageHeader({ kicker, name, period, title }: { kicker: string; name: string; period?: string; title: string }) {
  return (
    <div>
      <div style={{ fontSize: "7.5pt", letterSpacing: ".1em", textTransform: "uppercase", color: "#94a3b8", marginBottom: "1.5mm" }}>
        {kicker} &nbsp;·&nbsp; Prepared for <strong>{name}</strong>{period && <> &nbsp;·&nbsp; {period}</>}
      </div>
      <div style={{ fontFamily: DOC_SERIF, fontSize: "18pt", fontWeight: 300, color: "#334155", lineHeight: 1.1 }}>{title}</div>
      <hr style={{ width: "18mm", height: "3px", background: DOC_TAN, border: "none", marginTop: "2.5mm" }} />
    </div>
  );
}
