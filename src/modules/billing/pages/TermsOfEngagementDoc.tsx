import ReactMarkdown from "react-markdown";
import prosperwiseLogo from "@/assets/prosperwise-icon-paper.png";
import termsMarkdown from "../../../../docs/legal/TERMS_OF_ENGAGEMENT.md?raw";

/**
 * /terms-of-engagement — the actual Terms of Engagement document, hosted
 * on our own domain rather than an Adobe Web Form. Linked from the
 * name/email/agree gate on /pay/:slug; the checkbox there is the sole
 * acceptance mechanism, not a signature — this page is just the document
 * being agreed to.
 */
const TermsOfEngagementDoc = () => {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-accent/40 bg-primary sticky top-0 z-10">
        <div className="mx-auto max-w-3xl px-4 py-4 sm:px-6 flex items-center gap-3">
          <img src={prosperwiseLogo} alt="ProsperWise" className="h-9 w-9 rounded-full" />
          <h1 className="text-lg font-semibold text-primary-foreground font-serif">
            ProsperWise Advisors
          </h1>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <div className="prose prose-sm max-w-none prose-headings:font-serif prose-headings:text-foreground prose-p:text-foreground prose-strong:text-foreground prose-li:text-foreground prose-a:text-accent">
          <ReactMarkdown>{termsMarkdown}</ReactMarkdown>
        </div>
      </main>

      <footer className="border-t border-border mt-12">
        <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 text-center">
          <p className="text-xs text-muted-foreground">ProsperWise Advisors, Your Family CFO</p>
        </div>
      </footer>
    </div>
  );
};

export default TermsOfEngagementDoc;
