import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { useUser } from "@clerk/react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ToastAction } from "@/components/ui/toast";
import { useToast } from "@/hooks/use-toast";

const API = import.meta.env.VITE_API_URL ?? "";

export type BlockedReportKind =
  | "video_url"
  | "funscript_file"
  | "community_submission"
  | "library_url"
  | "library_file"
  | "scripter_url"
  | "player_file"
  | "other";

export interface OpenBlockedReportOpts {
  kind: BlockedReportKind;
  item: string;
  blockMessage: string;
}

interface BlockedReportContextValue {
  openBlockedReport: (opts: OpenBlockedReportOpts) => void;
  /** Returns a ToastAction node that opens the report dialog with the given context. */
  reportAction: (opts: OpenBlockedReportOpts) => ReturnType<typeof ToastAction>;
}

const Ctx = createContext<BlockedReportContextValue | null>(null);

export function BlockedReportProvider({ children }: { children: ReactNode }) {
  const { user } = useUser();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState<OpenBlockedReportOpts | null>(null);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const openBlockedReport = useCallback((o: OpenBlockedReportOpts) => {
    setOpts(o);
    setReason("");
    setOpen(true);
  }, []);

  const reportAction = useCallback(
    (o: OpenBlockedReportOpts) => (
      <ToastAction altText="Report this block" onClick={() => openBlockedReport(o)}>
        Think this is in error?
      </ToastAction>
    ),
    [openBlockedReport]
  );

  const handleSubmit = async () => {
    if (!opts || !reason.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch(`${API}/api/block-reports`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: opts.kind,
          item: opts.item,
          blockMessage: opts.blockMessage,
          reason: reason.trim(),
          userEmail: user?.primaryEmailAddress?.emailAddress ?? null,
        }),
      });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      toast({
        title: "Report sent",
        description: "Thanks — we'll review this and get back to you if needed.",
      });
      setOpen(false);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Couldn't send report",
        description: err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Ctx.Provider value={{ openBlockedReport, reportAction }}>
      {children}
      <Dialog open={open} onOpenChange={(o) => !submitting && setOpen(o)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Report a blocked item</DialogTitle>
            <DialogDescription>
              Tell us why you think this should have been allowed. We review every report.
            </DialogDescription>
          </DialogHeader>
          {opts && (
            <div className="space-y-3 py-2 text-sm">
              <div>
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                  What was blocked
                </div>
                <div className="rounded-md border border-border bg-muted/40 px-3 py-2 break-all">
                  {opts.item || <span className="text-muted-foreground italic">(no value)</span>}
                </div>
              </div>
              <div>
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                  Why it was blocked
                </div>
                <div className="rounded-md border border-border bg-muted/40 px-3 py-2">
                  {opts.blockMessage}
                </div>
              </div>
              <div>
                <label
                  htmlFor="block-report-reason"
                  className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1 block"
                >
                  Why do you think this is in error?
                </label>
                <Textarea
                  id="block-report-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={4}
                  maxLength={2000}
                  placeholder="e.g. This is a legitimate video host that's just not on your allowlist yet..."
                  data-testid="textarea-block-report-reason"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={submitting || !reason.trim()}
              data-testid="button-submit-block-report"
            >
              {submitting ? "Sending..." : "Send report"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Ctx.Provider>
  );
}

export function useBlockedReport(): BlockedReportContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useBlockedReport must be used inside <BlockedReportProvider>");
  return ctx;
}
