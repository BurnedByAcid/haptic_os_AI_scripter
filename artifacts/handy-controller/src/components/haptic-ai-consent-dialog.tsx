import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import * as DialogPrimitive from "@radix-ui/react-dialog";

interface HapticAIConsentDialogProps {
  open: boolean;
  onConfirm: (dontShowAgain: boolean) => void;
  onCancel: () => void;
}

export function HapticAIConsentDialog({
  open,
  onConfirm,
  onCancel,
}: HapticAIConsentDialogProps) {
  const [dontShowAgain, setDontShowAgain] = useState(false);

  function handleConfirm() {
    onConfirm(dontShowAgain);
    setDontShowAgain(false);
  }

  function handleCancel() {
    setDontShowAgain(false);
    onCancel();
  }

  return (
    <DialogPrimitive.Root open={open}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className="fixed left-[50%] top-[50%] z-50 w-full max-w-md translate-x-[-50%] translate-y-[-50%] rounded-lg border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] flex flex-col gap-4"
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-full bg-yellow-500/15 border border-yellow-500/30 flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="h-4 w-4 text-yellow-500" />
            </div>
            <DialogPrimitive.Title className="text-base font-semibold leading-snug">
              HapticAI — Setup Required
            </DialogPrimitive.Title>
          </div>

          <div className="text-sm text-muted-foreground space-y-3 leading-relaxed">
            <p>
              Before you can use HapticAI, a separate local application called{" "}
              <strong className="text-foreground">FunGen</strong> must be
              downloaded and installed into a custom sandbox on your computer.
            </p>
            <p>
              FunGen runs entirely on your machine — no data leaves your computer
              during generation. It is a self-contained executable and requires no
              command-line knowledge to set up.
            </p>
            <p>
              You will be guided through the setup steps on the HapticAI page.
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            <Checkbox
              id="haptic-ai-consent-no-show"
              checked={dontShowAgain}
              onCheckedChange={(val) => setDontShowAgain(!!val)}
            />
            <label
              htmlFor="haptic-ai-consent-no-show"
              className="text-sm text-muted-foreground cursor-pointer select-none"
            >
              Don't show this again
            </label>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={handleCancel}>
              Cancel
            </Button>
            <Button onClick={handleConfirm}>
              I Understand
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
