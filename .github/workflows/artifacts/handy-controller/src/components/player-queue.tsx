import { useState, useEffect } from "react";
import { getEntry, LibraryEntry } from "@/lib/db";
import { Film, FileJson, ChevronDown, ChevronUp, ListVideo } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface QueueState {
  itemIds: string[];
  index: number;
  playlistName?: string;
}

interface PlayerQueueProps {
  queue: QueueState | null;
  onJump: (index: number, entry: LibraryEntry) => void;
}

export function PlayerQueue({ queue, onJump }: PlayerQueueProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [entries, setEntries] = useState<(LibraryEntry | null)[]>([]);

  useEffect(() => {
    if (!queue) { setEntries([]); return; }
    let cancelled = false;
    Promise.all(queue.itemIds.map(id => getEntry(id).then(e => e ?? null))).then(results => {
      if (!cancelled) setEntries(results);
    });
    return () => { cancelled = true; };
  }, [queue]);

  if (!queue || queue.itemIds.length === 0) return null;

  return (
    <div className="rounded-xl border border-border/50 bg-card/50 overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-background/40 transition-colors"
        onClick={() => setCollapsed(v => !v)}
      >
        <div className="flex items-center gap-2">
          <ListVideo className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold">
            {queue.playlistName ? queue.playlistName : "Queue"}
          </span>
          <span className="text-xs text-muted-foreground">
            {queue.index + 1} / {queue.itemIds.length}
          </span>
        </div>
        {collapsed
          ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
          : <ChevronUp className="h-4 w-4 text-muted-foreground" />
        }
      </button>

      {!collapsed && (
        <div className="border-t border-border/40 max-h-56 overflow-y-auto">
          {entries.map((entry, idx) => {
            const isActive = idx === queue.index;
            return (
              <button
                key={queue.itemIds[idx]}
                onClick={() => { if (entry) onJump(idx, entry); }}
                disabled={!entry}
                className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-left transition-colors ${
                  isActive
                    ? "bg-primary/15 border-l-2 border-primary"
                    : "border-l-2 border-transparent hover:bg-background/50"
                } disabled:opacity-40`}
              >
                <span className={`text-xs font-mono w-5 shrink-0 text-right ${isActive ? "text-primary font-bold" : "text-muted-foreground"}`}>
                  {idx + 1}.
                </span>
                {entry ? (
                  entry.type === "video"
                    ? <Film className={`h-3.5 w-3.5 shrink-0 ${isActive ? "text-primary" : "text-muted-foreground"}`} />
                    : <FileJson className={`h-3.5 w-3.5 shrink-0 ${isActive ? "text-primary" : "text-muted-foreground"}`} />
                ) : (
                  <Film className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />
                )}
                <span className={`text-sm truncate ${isActive ? "text-primary font-medium" : ""}`}>
                  {entry?.name ?? "Missing entry"}
                </span>
                {isActive && (
                  <span className="ml-auto text-[10px] text-primary font-semibold uppercase tracking-wider shrink-0">Now</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface QueueNavProps {
  queue: QueueState | null;
  onPrev: () => void;
  onNext: () => void;
}

export function QueueNav({ queue, onPrev, onNext }: QueueNavProps) {
  if (!queue || queue.itemIds.length < 2) return null;
  return (
    <div className="flex items-center gap-1">
      <Button
        size="icon"
        variant="ghost"
        className="h-7 w-7 text-muted-foreground hover:text-foreground"
        onClick={onPrev}
        disabled={queue.index === 0}
        title="Previous in queue"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
          <polygon points="19 20 9 12 19 4 19 20"/>
          <line x1="5" y1="19" x2="5" y2="5"/>
        </svg>
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="h-7 w-7 text-muted-foreground hover:text-foreground"
        onClick={onNext}
        disabled={queue.index === queue.itemIds.length - 1}
        title="Next in queue"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
          <polygon points="5 4 15 12 5 20 5 4"/>
          <line x1="19" y1="4" x2="19" y2="20"/>
        </svg>
      </Button>
    </div>
  );
}
