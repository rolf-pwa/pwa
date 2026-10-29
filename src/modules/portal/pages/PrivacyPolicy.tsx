import { Link } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import { ArrowLeft } from "lucide-react";
import prosperwiseLogo from "@/assets/prosperwise-icon-paper.png";
import policyMarkdown from "../../../../docs/compliance/PRIVACY_AND_SECURITY_POLICY.md?raw";

const PrivacyPolicy = () => {
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
        <Link
          to="/portal"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Portal
        </Link>

        <div className="prose prose-sm max-w-none prose-headings:font-serif prose-headings:text-foreground prose-p:text-foreground prose-strong:text-foreground prose-li:text-foreground prose-a:text-accent">
          <ReactMarkdown>{policyMarkdown}</ReactMarkdown>
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

export default PrivacyPolicy;
