import { useState, useEffect } from "react";
import { Playlist, LibraryEntry } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Film, FileJson, GripVertical, Plus, X, ChevronUp, ChevronDown } from "lucide-react";

interface PlaylistEditorDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (name: string, itemIds: string[]) => void;
  playlist?: Playlist | null;
  allEntries: LibraryEntry[];
}

export function PlaylistEditorDialog({
  open,
  onClose,
  onSave,
  playlist,
  allEntries,
}: PlaylistEditorDialogProps) {
  const [name, setName] = useState("");
  const [itemIds, setItemIds] = useState<string[]>([]);
  const [addSearch, setAddSearch] = useState("");
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  useEffect(() => {
    if (open) {
      setName(playlist?.name ?? "");
      setItemIds(playlist?.itemIds ?? []);
      setAddSearch("");
    }
  }, [open, playlist]);

  const items = itemIds
    .map(id => allEntries.find(e => e.id === id))
    .filter(Boolean) as LibraryEntry[];

  // Only video entries are playable in a queue — funscripts are excluded
  const videoEntries = allEntries.filter(e => e.type === "video");
  const notInList = videoEntries.filter(e => !itemIds.includes(e.id));
  const filtered = notInList.filter(e =>
    e.name.toLowerCase().includes(addSearch.toLowerCase())
  );

  const addItem = (id: string) => {
    setItemIds(prev => [...prev, id]);
  };

  const removeItem = (id: string) => {
    setItemIds(prev => prev.filter(i => i !== id));
  };

  const moveUp = (idx: number) => {
    if (idx === 0) return;
    setItemIds(prev => {
      const next = [...prev];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      return next;
    });
  };

  const moveDown = (idx: number) => {
    if (idx === itemIds.length - 1) return;
    setItemIds(prev => {
      const next = [...prev];
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      return next;
    });
  };

  const onDragStart = (idx: number) => setDragIdx(idx);
  const onDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    setDragOverIdx(idx);
  };
  const onDrop = (idx: number) => {
    if (dragIdx === null || dragIdx === idx) {
      setDragIdx(null);
      setDragOverIdx(null);
      return;
    }
    setItemIds(prev => {
      const next = [...prev];
      const [moved] = next.splice(dragIdx, 1);
      next.splice(idx, 0, moved);
      return next;
    });
    setDragIdx(null);
    setDragOverIdx(null);
  };
  const onDragEnd = () => {
    setDragIdx(null);
    setDragOverIdx(null);
  };

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSave(trimmed, itemIds);
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl bg-card border-border/60 max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{playlist ? "Edit Playlist" : "New Playlist"}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 flex-1 min-h-0 overflow-hidden">
          {/* Name */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Playlist Name</label>
            <Input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="My Playlist"
              autoFocus
              onKeyDown={e => { if (e.key === "Enter") handleSave(); }}
            />
          </div>

          <div className="grid grid-cols-2 gap-4 flex-1 min-h-0 overflow-hidden">
            {/* Current items */}
            <div className="flex flex-col gap-2 min-h-0">
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                Queue ({items.length})
              </p>
              <div className="flex-1 overflow-y-auto space-y-1 pr-1 min-h-0 max-h-72">
                {items.length === 0 && (
                  <p className="text-xs text-muted-foreground py-4 text-center">
                    Add items from the right panel
                  </p>
                )}
                {items.map((entry, idx) => (
                  <div
                    key={entry.id}
                    draggable
                    onDragStart={() => onDragStart(idx)}
                    onDragOver={e => onDragOver(e, idx)}
                    onDrop={() => onDrop(idx)}
                    onDragEnd={onDragEnd}
                    className={`flex items-center gap-2 px-2 py-1.5 rounded-md border transition-colors cursor-grab active:cursor-grabbing select-none ${
                      dragOverIdx === idx && dragIdx !== idx
                        ? "border-primary/60 bg-primary/10"
                        : "border-border/40 bg-background/40 hover:bg-background/70"
                    }`}
                  >
                    <GripVertical className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
                    <span className="text-xs text-muted-foreground shrink-0 w-5 text-right">{idx + 1}.</span>
                    {/* Thumbnail or icon */}
                    {entry.thumbnail ? (
                      <img
                        src={entry.thumbnail}
                        alt=""
                        className="h-7 w-12 object-cover rounded shrink-0 bg-black"
                        draggable={false}
                      />
                    ) : entry.type === "video" ? (
                      <div className="h-7 w-12 rounded shrink-0 bg-muted flex items-center justify-center">
                        <Film className="h-3.5 w-3.5 text-muted-foreground" />
                      </div>
                    ) : (
                      <div className="h-7 w-12 rounded shrink-0 bg-muted flex items-center justify-center">
                        <FileJson className="h-3.5 w-3.5 text-muted-foreground" />
                      </div>
                    )}
                    <span className="text-sm truncate flex-1">{entry.name}</span>
                    <div className="flex items-center shrink-0">
                      <button
                        onClick={() => moveUp(idx)}
                        disabled={idx === 0}
                        className="h-5 w-5 flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-30"
                      >
                        <ChevronUp className="h-3 w-3" />
                      </button>
                      <button
                        onClick={() => moveDown(idx)}
                        disabled={idx === items.length - 1}
                        className="h-5 w-5 flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-30"
                      >
                        <ChevronDown className="h-3 w-3" />
                      </button>
                      <button
                        onClick={() => removeItem(entry.id)}
                        className="h-5 w-5 flex items-center justify-center text-muted-foreground hover:text-destructive"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Library picker */}
            <div className="flex flex-col gap-2 min-h-0">
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                Library
              </p>
              <Input
                value={addSearch}
                onChange={e => setAddSearch(e.target.value)}
                placeholder="Search…"
                className="h-8 text-sm"
              />
              <div className="flex-1 overflow-y-auto space-y-1 pr-1 min-h-0 max-h-60">
                {filtered.length === 0 && (
                  <p className="text-xs text-muted-foreground py-4 text-center">
                    {notInList.length === 0 ? "All items added" : "No results"}
                  </p>
                )}
                {filtered.map(entry => (
                  <button
                    key={entry.id}
                    onClick={() => addItem(entry.id)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md border border-border/40 bg-background/40 hover:bg-background/70 hover:border-primary/40 transition-colors text-left"
                  >
                    {entry.type === "video"
                      ? <Film className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      : <FileJson className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                    <span className="text-sm truncate flex-1">{entry.name}</span>
                    <Plus className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="pt-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={!name.trim()}>
            {playlist ? "Save Changes" : "Create Playlist"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
