import { useState } from "react";
import { AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";

export function HapticAIWarningBanner() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="border-b border-yellow-500/30 bg-yellow-500/5">
      {/* Always-visible summary row */}
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-center gap-2 px-4 py-2 text-left hover:bg-yellow-500/5 transition-colors"
        aria-expanded={!collapsed}
      >
        <AlertTriangle className="h-3.5 w-3.5 text-yellow-500 flex-shrink-0" />
        <span className="text-xs font-medium text-yellow-600 dark:text-yellow-400 flex-1">
          HapticAI (Beta) — Experimental tool. Use at your own risk. Outputs are AI-generated and may be unsuitable.
        </span>
        {collapsed ? (
          <ChevronDown className="h-3.5 w-3.5 text-yellow-500/70 flex-shrink-0" />
        ) : (
          <ChevronUp className="h-3.5 w-3.5 text-yellow-500/70 flex-shrink-0" />
        )}
      </button>

      {/* Expandable details */}
      {!collapsed && (
        <div className="px-4 pb-3 pt-1 text-xs text-muted-foreground space-y-1.5 border-t border-yellow-500/20">
          <p>
            <strong className="text-foreground">This feature is experimental.</strong> Generated haptic scripts
            may contain unexpected patterns. Always review scripts before use and start at low intensities.
          </p>
          <p>
            <strong className="text-foreground">No liability.</strong> The developer is not responsible for any
            outputs, discomfort, or device effects resulting from use of HapticAI.
          </p>
          <p>
            <strong className="text-foreground">Local processing.</strong> Prompts are sent only to the HapticAI
            app running on your computer. Nothing is transmitted to external servers.
          </p>
        </div>
      )}
    </div>
  );
}
