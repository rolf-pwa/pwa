import { useState, useRef, useEffect } from "react";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Badge } from "@/shared/components/ui/badge";
import { ScrollArea } from "@/shared/components/ui/scroll-area";
import { Separator } from "@/shared/components/ui/separator";
import { Switch } from "@/shared/components/ui/switch";
import {
  Bot,
  Send,
  Loader2,
  Paperclip,
  Shield,
  X,
  MessageSquare,
  Brain,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import { askAssistant, type Message, type FunctionCall, type AssistantResponse } from "@/shared/lib/vertex-ai";
import { type BrainCitation } from "@/shared/lib/brain";
import { CitationList } from "@/shared/components/CitationList";
import { ProposedUpdateCard } from "./ProposedUpdateCard";
import { toast } from "sonner";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  functionCalls?: FunctionCall[];
  citations?: BrainCitation[];
  approvedActions?: Set<number>;
  timestamp: Date;
}

interface SovereigntyAssistantProps {
  contactContext?: Record<string, any>;
  contactId?: string;
  variant?: "sidebar" | "embedded";
}

export function SovereigntyAssistant({
  contactContext,
  contactId,
  variant = "sidebar",
}: SovereigntyAssistantProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [attachedFile, setAttachedFile] = useState<{ name: string; mimeType: string; base64: string } | null>(null);
  const [useBrain, setUseBrain] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleFileAttach = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      toast.error("File too large. Maximum 10MB.");
      return;
    }

    const allowedTypes = ["application/pdf", "image/png", "image/jpeg", "image/webp"];
    if (!allowedTypes.includes(file.type)) {
      toast.error("Unsupported file type. Use PDF, PNG, JPEG, or WebP.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1];
      setAttachedFile({ name: file.name, mimeType: file.type, base64 });
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const sendMessage = async () => {
    const text = input.trim();
    if (!text && !attachedFile) return;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: text || `[Attached: ${attachedFile?.name}]`,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsLoading(true);

    try {
      const apiMessages: Message[] = [
        ...messages.map((m) => ({ role: m.role, content: m.content } as Message)),
        { role: "user" as const, content: text || "Please analyze the attached document." },
      ];

      const response: AssistantResponse = await askAssistant(
        apiMessages,
        contactContext,
        attachedFile ? { mimeType: attachedFile.mimeType, base64: attachedFile.base64 } : undefined,
        undefined,
        useBrain,
      );

      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: response.text,
        functionCalls: response.functionCalls.length > 0 ? response.functionCalls : undefined,
        citations: response.citations.length > 0 ? response.citations : undefined,
        approvedActions: new Set(),
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, assistantMsg]);
      setAttachedFile(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to get response");
    } finally {
      setIsLoading(false);
    }
  };

  const markActionApproved = (messageId: string, actionIndex: number) => {
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id === messageId) {
          const approved = new Set(m.approvedActions);
          approved.add(actionIndex);
          return { ...m, approvedActions: approved };
        }
        return m;
      })
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const isEmbedded = variant === "embedded";

  return (
    <Card className={isEmbedded ? "border-0 shadow-none" : ""}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
            <Bot className="h-4 w-4 text-primary" />
          </div>
          Sovereignty Assistant
          <Badge variant="outline" className="ml-auto text-[10px] font-normal">
            Draft Mode
          </Badge>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          AI-powered support · All outputs are drafts for your review
        </p>
        {contactContext?.name && (
          <p className="text-xs text-muted-foreground">
            Currently viewing: <span className="font-medium text-foreground">{contactContext.name}</span>
            {contactContext.type ? ` (${contactContext.type})` : ""}
          </p>
        )}
        <label className="flex items-center gap-2 pt-1 text-xs text-muted-foreground">
          <Switch checked={useBrain} onCheckedChange={setUseBrain} className="scale-75" />
          <Brain className="h-3 w-3" />
          Use Second Brain
        </label>
      </CardHeader>

      <Separator />

      <CardContent className="p-0">
        {/* Chat messages */}
        <ScrollArea className={isEmbedded ? "h-[240px]" : "h-[500px]"}>
          <div className="space-y-4 p-4">
            {messages.length === 0 && (
              <div className="flex flex-col items-center gap-3 py-12 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                  <Shield className="h-6 w-6 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm font-medium">Ready to assist, Personal CFO</p>
                  <p className="mt-1 text-xs text-muted-foreground max-w-[280px]">
                    Upload documents for analysis, ask about contact financials, or request draft emails and tasks.
                  </p>
                </div>
              </div>
            )}

            {messages.map((msg) => (
              <div key={msg.id} className={`flex gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                {msg.role === "assistant" && (
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
                    <Bot className="h-3.5 w-3.5 text-primary" />
                  </div>
                )}
                <div className={`max-w-[85%] space-y-2 ${msg.role === "user" ? "order-first" : ""}`}>
                  <div
                    className={`rounded-lg px-3 py-2 text-sm ${
                      msg.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted"
                    }`}
                  >
                    {msg.role === "assistant" ? (
                      <div className="prose prose-sm max-w-none dark:prose-invert">
                        <ReactMarkdown>{msg.content}</ReactMarkdown>
                      </div>
                    ) : (
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                    )}
                  </div>

                  {msg.citations && msg.citations.length > 0 && <CitationList citations={msg.citations} />}

                  {/* Function call cards */}
                  {msg.functionCalls?.map((fc, idx) => (
                    <ProposedUpdateCard
                      key={idx}
                      functionCall={fc}
                      contactId={contactId}
                      householdId={contactContext?.householdId}
                      isApproved={msg.approvedActions?.has(idx) || false}
                      onApproved={() => markActionApproved(msg.id, idx)}
                    />
                  ))}
                </div>

                {msg.role === "user" && (
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/20">
                    <MessageSquare className="h-3.5 w-3.5 text-accent" />
                  </div>
                )}
              </div>
            ))}

            {isLoading && (
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10">
                  <Bot className="h-3.5 w-3.5 text-primary" />
                </div>
                <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Analyzing...
                </div>
              </div>
            )}

            <div ref={scrollRef} />
          </div>
        </ScrollArea>

        {/* Attached file indicator */}
        {attachedFile && (
          <div className="mx-4 mb-2 flex items-center gap-2 rounded-md border bg-muted/50 px-3 py-1.5 text-xs">
            <Paperclip className="h-3 w-3 text-muted-foreground" />
            <span className="flex-1 truncate">{attachedFile.name}</span>
            <button onClick={() => setAttachedFile(null)} className="text-muted-foreground hover:text-foreground">
              <X className="h-3 w-3" />
            </button>
          </div>
        )}

        {/* Input */}
        <div className="flex items-end gap-2 border-t p-3">
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={handleFileAttach}
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => fileInputRef.current?.click()}
            disabled={isLoading}
          >
            <Paperclip className="h-4 w-4" />
          </Button>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask the Sovereignty Assistant..."
            className="flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            rows={1}
            disabled={isLoading}
          />
          <Button
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={sendMessage}
            disabled={isLoading || (!input.trim() && !attachedFile)}
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
