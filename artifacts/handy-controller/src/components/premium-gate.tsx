import { Lock, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSubscription } from "@/hooks/use-subscription";
import { useUser, useClerk } from "@clerk/react";
import { Link } from "wouter";

interface PremiumGateProps {
  children: React.ReactNode;
  feature?: string;
}

/**
 * Wraps any content with a locked overlay when the user is on the free plan.
 * Pro / Admin users see the content normally.
 */
export function PremiumGate({ children, feature }: PremiumGateProps) {
  const { isPro, isLoaded } = useSubscription();
  const { user } = useUser();
  const { openSignIn } = useClerk();

  if (!isLoaded) return <>{children}</>;
  if (isPro) return <>{children}</>;

  return (
    <div className="relative">
      <div className="pointer-events-none select-none blur-[2px] opacity-40">
        {children}
      </div>
      <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/80 backdrop-blur-sm rounded-lg z-10">
        <div className="flex flex-col items-center gap-3 p-6 text-center max-w-xs">
          <div className="h-12 w-12 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center">
            <Lock className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h3 className="font-semibold text-sm text-foreground">
              {feature ? `${feature} is a Pro feature` : "Pro feature"}
            </h3>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              Upgrade to Pro to unlock this and all upcoming features.
            </p>
          </div>
          {user ? (
            <Link href="/upgrade">
              <Button size="sm" className="gap-1.5 h-8 text-xs">
                <Sparkles className="h-3.5 w-3.5" />
                Upgrade to Pro
              </Button>
            </Link>
          ) : (
            <Button size="sm" className="gap-1.5 h-8 text-xs" onClick={() => openSignIn()}>
              <Lock className="h-3.5 w-3.5" />
              Sign in to access
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
