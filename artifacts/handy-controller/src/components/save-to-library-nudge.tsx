import { useState } from "react";
import { BookmarkPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";

const DISMISS_KEY = "save_to_library_nudge_dismissed_v1";

interface SaveToLibraryNudgeProps {
  onSave: () => void;
  onDismiss?: () => void;
}

export function SaveToLibraryNudge({ onSave, onDismiss }: SaveToLibraryNudgeProps) {
  const [dismissed, setDismissed] = useState(() =>
    sessionStorage.getItem(DISMISS_KEY) === "1"
  );

  if (dismissed) return null;

  const handleDismiss = () => {
    sessionStorage.setItem(DISMISS_KEY, "1");
    setDismissed(true);
    onDismiss?.();
  };

  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-lg border border-primary/30 bg-primary/5 flex-shrink-0">
      <BookmarkPlus className="h-4 w-4 text-primary shrink-0" />
      <span className="flex-1 text-sm text-muted-foreground">
        Video and script are ready —{" "}
        <span className="text-foreground font-medium">save this pair to your library?</span>
      </span>
      <Button
        size="sm"
        variant="outline"
        className="h-7 text-xs gap-1.5 border-primary/40 text-primary hover:bg-primary/10 shrink-0"
        onClick={onSave}
      >
        <BookmarkPlus className="h-3 w-3" />
        Save to Library
      </Button>
      <button
        className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
        onClick={handleDismiss}
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
