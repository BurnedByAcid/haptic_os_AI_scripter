import { Sparkles, ArrowLeft, Cpu, Brain, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";

export default function HapticAISoon() {
  const [, navigate] = useLocation();

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="max-w-md w-full space-y-8">

        {/* Icon */}
        <div className="flex justify-center">
          <div className="relative">
            <div className="h-24 w-24 rounded-2xl bg-gradient-to-br from-[#DC2626]/20 to-[#EF4444]/5 border border-[#DC2626]/30 flex items-center justify-center shadow-[0_0_60px_rgba(220,38,38,0.15)]">
              <Sparkles className="h-10 w-10 text-[#DC2626]" />
            </div>
            <span className="absolute -top-2 -right-2 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-[#DC2626]/20 text-[#DC2626] border border-[#DC2626]/40 leading-none">
              Beta
            </span>
          </div>
        </div>

        {/* Heading */}
        <div className="space-y-3">
          <h1 className="text-4xl font-bold tracking-tight">
            HapticAI
          </h1>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 text-sm font-medium">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
            Coming Soon
          </div>
        </div>

        {/* Description */}
        <p className="text-muted-foreground leading-relaxed">
          HapticAI is an AI-powered haptic script generator currently in closed beta.
          We're finalising the experience before a wider release.
        </p>

        {/* Feature hints */}
        <div className="grid grid-cols-3 gap-3 text-left">
          {[
            { icon: Brain,  label: "AI Detection",   desc: "Automatic scene analysis" },
            { icon: Zap,    label: "Real-time",       desc: "Live playback sync" },
            { icon: Cpu,    label: "Local Processing", desc: "Runs on your machine" },
          ].map(({ icon: Icon, label, desc }) => (
            <div key={label} className="rounded-lg border border-border/40 bg-card/30 p-3 space-y-1.5">
              <Icon className="h-4 w-4 text-[#DC2626]" />
              <p className="text-xs font-semibold text-foreground">{label}</p>
              <p className="text-[11px] text-muted-foreground leading-snug">{desc}</p>
            </div>
          ))}
        </div>

        {/* Back button */}
        <Button
          variant="ghost"
          className="gap-2 text-muted-foreground hover:text-foreground"
          onClick={() => navigate("/")}
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Dashboard
        </Button>
      </div>
    </div>
  );
}
