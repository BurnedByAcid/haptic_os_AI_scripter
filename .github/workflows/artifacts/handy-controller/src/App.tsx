import { useEffect, useRef } from "react";
import { Switch, Route, Router as WouterRouter, useLocation, Redirect } from "wouter";
import { ClerkProvider, useAuth, useUser } from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { dark } from "@clerk/themes";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { Layout } from "@/components/layout";
import { HandyProvider } from "@/contexts/handy-context";
import { BlockedReportProvider } from "@/contexts/blocked-report-context";
import { AppSettingsContext, useAppSettingsProvider } from "@/hooks/use-app-settings";
import { useSubscription } from "@/hooks/use-subscription";

import Home from "@/pages/home";
import Player from "@/pages/player";
import Control from "@/pages/control";
import Library from "@/pages/library";
import Games from "@/pages/games";
import Beat from "@/pages/beat";
import Scripter from "@/pages/scripter";
import SignInPage from "@/pages/sign-in";
import SignUpPage from "@/pages/sign-up";
import OnboardingPage from "@/pages/onboarding";
import Community from "@/pages/community";
import Upgrade from "@/pages/upgrade";
import Admin from "@/pages/admin";
import HapticAI from "@/pages/haptic-ai";
import HapticAISoon from "@/pages/haptic-ai-soon";
import AIScripter from "@/pages/aiscripter";

const queryClient = new QueryClient();

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);

const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

const clerkLocalization = {
  signIn: {
    start: {
      title: "Sign in to HapticOS",
      subtitle: "to continue to HapticOS",
    },
  },
  signUp: {
    start: {
      title: "Create your HapticOS account",
      subtitle: "to continue to HapticOS",
    },
  },
};

const clerkAppearance = {
  baseTheme: dark,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/hapticos-logo.jpg`,
    socialButtonsPlacement: "top" as const,
    socialButtonsVariant: "blockButton" as const,
  },
  variables: {
    colorPrimary: "#DC2626",
    colorForeground: "#E8D5BB",
    colorMutedForeground: "#A08070",
    colorDanger: "#EF4444",
    colorBackground: "#120404",
    colorInput: "#1E0707",
    colorInputForeground: "#E8D5BB",
    colorNeutral: "#3D1515",
    fontFamily: "system-ui, -apple-system, sans-serif",
    borderRadius: "0.75rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "!bg-[#120404] border border-[#3D1515] rounded-2xl w-[440px] max-w-full overflow-hidden shadow-2xl shadow-[#DC2626]/5",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-[#120404] !rounded-none border-t border-[#3D1515]",
    headerTitle: "font-bold",
    headerSubtitle: "text-[#A08070]",
    socialButtonsBlockButtonText: "font-medium",
    socialButtonsBlockButton: "!border-[#3D1515] hover:!border-[#DC2626]/50 !bg-[#1E0707] hover:!bg-[#1E0707]",
    formFieldLabel: "text-[#A08070] text-sm",
    formFieldInput: "!bg-[#1E0707] !border-[#3D1515] focus:!border-[#DC2626] focus:!ring-1 focus:!ring-[#DC2626]",
    formButtonPrimary: "!bg-[#DC2626] hover:!bg-[#DC2626]/90 font-bold",
    footerActionLink: "!text-[#DC2626] hover:!text-[#DC2626]/80",
    footerActionText: "!text-[#A08070]",
    dividerText: "!text-[#A08070]",
    dividerLine: "!bg-[#3D1515]",
    identityPreviewEditButton: "!text-[#DC2626]",
    formFieldSuccessText: "!text-green-400",
    alertText: "",
    alert: "!bg-[#1E0707] !border-[#3D1515]",
    otpCodeFieldInput: "!bg-[#1E0707] !border-[#3D1515]",
    formFieldRow: "",
    main: "",
    logoBox: "flex justify-center",
    logoImage: "h-12 w-auto",
    footerAction: "",
  },
};

/**
 * Redirects unauthenticated users to /sign-in.
 * Redirects authenticated but un-onboarded users to /onboarding.
 * Renders nothing while Clerk loads.
 */
function ProtectedRoute({
  component: Component,
  subscriberOnly = false,
  adminOnly = false,
  adminFallback = "/",
}: {
  component: React.ComponentType;
  subscriberOnly?: boolean;
  adminOnly?: boolean;
  adminFallback?: string;
}) {
  const { isLoaded: isAuthLoaded, isSignedIn } = useAuth();
  const { user, isLoaded: isUserLoaded } = useUser();
  const { isLoaded: isSubscriptionLoaded, isPro, isAdmin } = useSubscription();

  if (!isAuthLoaded || !isUserLoaded || !isSubscriptionLoaded) return null;
  if (!isSignedIn) return <Redirect to="/sign-in" />;

  const onboarded = (user?.publicMetadata as Record<string, unknown>)?.onboarded === true;
  if (!onboarded) return <Redirect to="/onboarding" />;
  if (subscriberOnly && !isPro) return <Redirect to="/upgrade" />;
  if (adminOnly && !isAdmin) return <Redirect to={adminFallback} />;

  return <Component />;
}

function Router() {
  return (
    <Switch>
      {/* Public: player works without an account */}
      <Route path="/player" component={Player} />

      {/* Auth pages */}
      <Route path="/sign-in/*?" component={SignInPage} />
      <Route path="/sign-up/*?" component={SignUpPage} />

      {/* Onboarding: only for signed-in users who haven't completed it */}
      <Route path="/onboarding" component={OnboardingPage} />

      {/* Everything else requires login + onboarding */}
      <Route path="/"          component={() => <ProtectedRoute component={Home} />} />
      <Route path="/control"   component={() => <ProtectedRoute component={Control} />} />
      <Route path="/local-library" component={() => <ProtectedRoute component={Library} />} />
      <Route path="/games"     component={() => <ProtectedRoute component={Games} />} />
      <Route path="/beat"      component={() => <ProtectedRoute component={Beat} />} />
      <Route path="/audio-cleaner" component={() => <Redirect to="/beat?tab=cleaner" />} />
      <Route path="/scripter"  component={() => <ProtectedRoute component={Scripter} />} />
      <Route path="/haptic-ai" component={() => <ProtectedRoute component={HapticAI} adminOnly adminFallback="/haptic-ai-soon" />} />
      <Route path="/haptic-ai-soon" component={() => <ProtectedRoute component={HapticAISoon} />} />
      <Route path="/aiscripter" component={() => <ProtectedRoute component={AIScripter} />} />
      <Route path="/community"    component={() => <ProtectedRoute component={Community} />} />
      <Route path="/upgrade"      component={() => <ProtectedRoute component={Upgrade} />} />
      <Route path="/admin"        component={() => <ProtectedRoute component={Admin} adminOnly />} />

      <Route component={NotFound} />
    </Switch>
  );
}

function AppSettingsProvider({ children }: { children: React.ReactNode }) {
  const value = useAppSettingsProvider();
  return (
    <AppSettingsContext.Provider value={value}>
      {children}
    </AppSettingsContext.Provider>
  );
}

function ClerkProviderWithRouter() {
  const [, setLocation] = useLocation();
  return (
    <ClerkProvider
      publishableKey={clerkPubKey!}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      localization={clerkLocalization}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      afterSignOutUrl={`${basePath}/`}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <AppSettingsProvider>
            <HandyProvider>
              <BlockedReportProvider>
                <Layout>
                  <Router />
                </Layout>
                <Toaster />
                <SonnerToaster />
              </BlockedReportProvider>
            </HandyProvider>
          </AppSettingsProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRouter />
    </WouterRouter>
  );
}

export default App;
