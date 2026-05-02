import { useUser } from "@clerk/react";

export type Plan = "free" | "pro" | "subscriber" | "admin";

export interface Subscription {
  plan: Plan;
  isPro: boolean;
  isAdmin: boolean;
  isFree: boolean;
  isLoaded: boolean;
}

/**
 * Reads the user's subscription plan from Clerk publicMetadata.
 * The `plan` field is set server-side via the admin API and cannot be
 * spoofed by the client.
 *
 * Defaults to "free" for any unauthenticated or unset user.
 * "subscriber" (Stripe-paid), "pro", and "admin" all count as full access.
 */
export function useSubscription(): Subscription {
  const { user, isLoaded } = useUser();

  const plan: Plan = (() => {
    if (!user) return "free";
    const raw = (user.publicMetadata as Record<string, unknown>)?.plan;
    if (raw === "admin" || raw === "pro" || raw === "subscriber" || raw === "free") return raw;
    return "free";
  })();

  return {
    plan,
    isPro: plan === "pro" || plan === "admin" || plan === "subscriber",
    isAdmin: plan === "admin",
    isFree: plan === "free",
    isLoaded,
  };
}
