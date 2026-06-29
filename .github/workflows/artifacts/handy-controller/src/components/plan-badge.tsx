import { Crown, ShieldCheck, Zap } from "lucide-react";
import { useSubscription, type Plan } from "@/hooks/use-subscription";

const BADGE_CONFIG: Record<Plan, { label: string; icon: typeof Crown; classes: string }> = {
  free: {
    label: "Free",
    icon: Zap,
    classes: "bg-muted/60 text-muted-foreground border-border/40",
  },
  pro: {
    label: "Pro",
    icon: Crown,
    classes: "bg-primary/10 text-primary border-primary/30",
  },
  subscriber: {
    label: "Subscriber",
    icon: Crown,
    classes: "bg-primary/10 text-primary border-primary/30",
  },
  admin: {
    label: "Admin",
    icon: ShieldCheck,
    classes: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
  },
};

interface PlanBadgeProps {
  collapsed?: boolean;
}

export function PlanBadge({ collapsed }: PlanBadgeProps) {
  const { plan, isLoaded } = useSubscription();
  if (!isLoaded) return null;

  const { label, icon: Icon, classes } = BADGE_CONFIG[plan];

  if (collapsed) {
    return (
      <div
        className={`h-5 w-5 rounded-full flex items-center justify-center border ${classes}`}
        title={`${label} plan`}
      >
        <Icon className="h-2.5 w-2.5" />
      </div>
    );
  }

  return (
    <div className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-[10px] font-semibold tracking-wide ${classes}`}>
      <Icon className="h-2.5 w-2.5" />
      {label}
    </div>
  );
}
