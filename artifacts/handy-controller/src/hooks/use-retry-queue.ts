import { useEffect } from "react";
import { toast } from "@/hooks/use-toast";

export type RetryAction = { label: string; fn: () => Promise<void> };

const queue: RetryAction[] = [];

/**
 * Enqueue an action to be retried when the browser comes back online.
 * If an entry with the same label already exists it is **replaced** by the
 * new one so the latest intent always wins (e.g. the user changed the active
 * script multiple times while offline — only the final choice should replay).
 */
export function enqueueRetry(label: string, fn: () => Promise<void>): void {
  const idx = queue.findIndex((q) => q.label === label);
  if (idx !== -1) {
    queue[idx] = { label, fn };
  } else {
    queue.push({ label, fn });
  }
}

/**
 * Mount this hook once (e.g. in Layout) to activate automatic retry flushing.
 * When the browser fires the `online` event, all queued actions are run in
 * parallel and a toast confirms how many were replayed.
 */
export function useRetryQueue(): void {
  useEffect(() => {
    const flush = async () => {
      if (queue.length === 0) return;
      const items = queue.splice(0, queue.length);
      const results = await Promise.allSettled(items.map((item) => item.fn()));
      const succeeded = results.filter((r) => r.status === "fulfilled").length;
      const failed = results.length - succeeded;

      if (succeeded > 0 && failed === 0) {
        toast({
          title: "Back online",
          description:
            succeeded === 1
              ? "1 deferred action was replayed successfully."
              : `${succeeded} deferred actions were replayed successfully.`,
        });
      } else if (succeeded > 0 && failed > 0) {
        toast({
          title: "Back online",
          description: `${succeeded} action${succeeded !== 1 ? "s" : ""} replayed; ${failed} still failed — please try again.`,
          variant: "destructive",
        });
      } else if (failed > 0) {
        toast({
          title: "Still having trouble",
          description: `${failed} deferred action${failed !== 1 ? "s" : ""} failed after reconnecting.`,
          variant: "destructive",
        });
      }
    };

    window.addEventListener("online", flush);
    return () => window.removeEventListener("online", flush);
  }, []);
}
