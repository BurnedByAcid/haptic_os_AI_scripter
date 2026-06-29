import { Tag, X, Check, Search } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  LIBRARY_TAGS,
  type LibraryTag,
  MAX_TAG_FILTERS,
  MAX_TAGS_PER_ENTRY,
} from "@workspace/validation";

/**
 * Reusable tag picker UI used by My Library and Community.
 *
 * Two modes:
 *   - mode="filter"  → pick up to MAX_TAG_FILTERS (3) tags to narrow a search.
 *   - mode="edit"    → pick up to MAX_TAGS_PER_ENTRY (5) tags for a single entry.
 *
 * The component re-validates client-side for UX, but the server is the
 * source of truth (see `validateTagsForWrite` in @workspace/validation).
 */
export function TagPicker({
  selected,
  onChange,
  mode,
  buttonLabel,
  buttonSize = "sm",
}: {
  selected: readonly string[];
  onChange: (next: LibraryTag[]) => void;
  mode: "filter" | "edit";
  buttonLabel?: string;
  buttonSize?: "sm" | "default";
}) {
  const [search, setSearch] = useState("");
  const cap = mode === "filter" ? MAX_TAG_FILTERS : MAX_TAGS_PER_ENTRY;
  const atCap = selected.length >= cap;
  const label =
    buttonLabel ?? (mode === "filter" ? "Filter by tag" : "Tags");

  const filteredTags = search.trim()
    ? LIBRARY_TAGS.filter((tag) =>
        tag.toLowerCase().includes(search.trim().toLowerCase())
      )
    : LIBRARY_TAGS;

  function toggle(tag: LibraryTag) {
    if (selected.includes(tag)) {
      onChange(selected.filter((t) => t !== tag) as LibraryTag[]);
    } else {
      if (atCap) return; // hard cap; UI shows hint below
      onChange([...selected, tag] as LibraryTag[]);
    }
  }

  return (
    <DropdownMenu onOpenChange={(open) => { if (!open) setSearch(""); }}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size={buttonSize}
          className="gap-1.5"
          data-testid="button-tag-picker"
        >
          <Tag className="h-3.5 w-3.5" />
          {label}
          {selected.length > 0 && (
            <span className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full bg-primary/20 text-primary text-[10px] font-semibold">
              {selected.length}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56 p-0">
        <div className="p-2 pb-1">
          <DropdownMenuLabel className="text-[11px] uppercase tracking-wide text-muted-foreground flex items-center justify-between px-0 pt-0 pb-1.5">
            <span>Tags</span>
            <span className="font-normal normal-case">
              {selected.length}/{cap}
            </span>
          </DropdownMenuLabel>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tags…"
              className="h-7 pl-6 text-xs"
              data-testid="tag-picker-search"
              onKeyDown={(e) => e.stopPropagation()}
            />
          </div>
        </div>
        <DropdownMenuSeparator className="my-0" />
        <div className="max-h-72 overflow-y-auto">
          {filteredTags.length === 0 ? (
            <div className="px-2 py-3 text-center text-[11px] text-muted-foreground">
              No tags match "{search}"
            </div>
          ) : (
            filteredTags.map((tag) => {
              const isSelected = selected.includes(tag);
              const disabled = !isSelected && atCap;
              return (
                <DropdownMenuItem
                  key={tag}
                  onSelect={(e) => {
                    e.preventDefault(); // keep menu open for multi-select
                    if (!disabled) toggle(tag);
                  }}
                  disabled={disabled}
                  className="text-xs gap-2"
                  data-testid={`menu-tag-${tag}`}
                >
                  <span
                    className={`flex h-4 w-4 items-center justify-center rounded-sm border ${
                      isSelected
                        ? "bg-primary border-primary text-primary-foreground"
                        : "border-border/60"
                    }`}
                  >
                    {isSelected && <Check className="h-3 w-3" />}
                  </span>
                  <span className="flex-1">{tag}</span>
                </DropdownMenuItem>
              );
            })
          )}
        </div>
        {atCap && (
          <>
            <DropdownMenuSeparator className="my-0" />
            <div className="px-2 py-1.5 text-[11px] text-amber-400">
              {mode === "filter"
                ? `Up to ${cap} tags at a time. Remove one to add another.`
                : `Max ${cap} tags per entry.`}
            </div>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Removable chips for actively-selected filter tags. Renders nothing when
 * the selection is empty.
 */
export function ActiveTagChips({
  selected,
  onRemove,
}: {
  selected: readonly string[];
  onRemove: (tag: string) => void;
}) {
  if (selected.length === 0) return null;
  return (
    <div className="flex items-center gap-1.5 flex-wrap" data-testid="active-tag-chips">
      {selected.map((tag) => (
        <button
          key={tag}
          onClick={() => onRemove(tag)}
          className="inline-flex items-center gap-1 rounded-full bg-primary/15 text-primary text-[11px] font-medium pl-2 pr-1 py-0.5 hover:bg-primary/25 transition-colors"
          title={`Remove "${tag}"`}
          data-testid={`chip-active-tag-${tag}`}
        >
          <span>{tag}</span>
          <X className="h-3 w-3" />
        </button>
      ))}
    </div>
  );
}

/**
 * Read-only chips rendered on entry cards. Click adds the tag to the
 * caller's active filter (subject to the filter cap).
 */
export function CardTagChips({
  tags,
  onTagClick,
}: {
  tags: readonly string[] | null | undefined;
  onTagClick?: (tag: string) => void;
}) {
  if (!tags || tags.length === 0) return null;
  return (
    <div className="flex items-center gap-1 flex-wrap" data-testid="card-tag-chips">
      {tags.map((tag) => (
        <button
          key={tag}
          onClick={(e) => {
            e.stopPropagation();
            onTagClick?.(tag);
          }}
          className="inline-flex items-center rounded-full bg-muted/60 hover:bg-primary/20 hover:text-primary text-[10px] text-muted-foreground px-1.5 py-0.5 transition-colors"
          title={onTagClick ? `Filter by "${tag}"` : tag}
          data-testid={`chip-card-tag-${tag}`}
        >
          {tag}
        </button>
      ))}
    </div>
  );
}
