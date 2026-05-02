import { useEffect, useRef } from "react";
import { Switch, Route, Router as WouterRouter, useLocation, Redirect } from "wouter";
import { ClerkProvider, useAuth, useUser } from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { dark } from "@clerk/themes";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { Layout } from "@/components/layout";
import { HandyProvider } from "@/contexts/handy-context";

import Home from "@/pages/home";
import Player from "@/pages/player";
import Control from "@/pages/control";
import Library from "@/pages/library";
import Games from "@/pages/games";
import Beat from "@/pages/beat";
import Scripter from "@/pages/scripter";
import AI from "@/pages/ai";
import SignInPage from "@/pages/sign-in";
import SignUpPage from "@/pages/sign-up";
import OnboardingPage from "@/pages/onboarding";
import Community from "@/pages/community";
import Upgrade from "@/pages/upgrade";
import Admin from "@/pages/admin";
import MyLibrary from "@/pages/my-library";
import Chat from "@/pages/chat";

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

const clerkAppearance = {
  baseTheme: dark,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
    socialButtonsPlacement: "top" as const,
    socialButtonsVariant: "blockButton" as const,
  },
  variables: {
    colorPrimary: "#A855F7",
    colorForeground: "#F5F0FF",
    colorMutedForeground: "#9D8CAD",
    colorDanger: "#EF4444",
    colorBackground: "#0D0B12",
    colorInput: "#17131F",
    colorInputForeground: "#F5F0FF",
    colorNeutral: "#302840",
    fontFamily: "system-ui, -apple-system, sans-serif",
    borderRadius: "0.75rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "!bg-[#0D0B12] border border-[#302840] rounded-2xl w-[440px] max-w-full overflow-hidden shadow-2xl shadow-[#A855F7]/5",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-[#0D0B12] !rounded-none border-t border-[#302840]",
    headerTitle: "text-white font-bold",
    headerSubtitle: "text-[#9D8CAD]",
    socialButtonsBlockButtonText: "text-white font-medium",
    socialButtonsBlockButton: "!border-[#302840] hover:!border-[#A855F7]/50 !bg-[#17131F] hover:!bg-[#17131F]",
    formFieldLabel: "text-[#9D8CAD] text-sm",
    formFieldInput: "!bg-[#17131F] !border-[#302840] !text-white focus:!border-[#A855F7] focus:!ring-1 focus:!ring-[#A855F7]",
    formButtonPrimary: "!bg-[#A855F7] !text-white hover:!bg-[#A855F7]/90 font-bold",
    footerActionLink: "!text-[#A855F7] hover:!text-[#A855F7]/80",
    footerActionText: "!text-[#9D8CAD]",
    dividerText: "!text-[#9D8CAD]",
    dividerLine: "!bg-[#302840]",
    identityPreviewEditButton: "!text-[#A855F7]",
    formFieldSuccessText: "!text-green-400",
    alertText: "!text-white",
    alert: "!bg-[#161B22] !border-[#30363D]",
    otpCodeFieldInput: "!bg-[#161B22] !border-[#30363D] !text-white",
    formFieldRow: "",
    main: "",
    logoBox: "flex justify-center",
    logoImage: "h-10 w-auto",
    footerAction: "",
  },
};

/**
 * Redirects unauthenticated users to /sign-in.
 * Redirects authenticated but un-onboarded users to /onboarding.
 * Renders nothing while Clerk loads.
 */
function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const { isLoaded: isAuthLoaded, isSignedIn } = useAuth();
  const { user, isLoaded: isUserLoaded } = useUser();

  if (!isAuthLoaded || !isUserLoaded) return null;
  if (!isSignedIn) return <Redirect to="/sign-in" />;

  const onboarded = (user?.publicMetadata as Record<string, unknown>)?.onboarded === true;
  if (!onboarded) return <Redirect to="/onboarding" />;

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
      <Route path="/library"       component={() => <ProtectedRoute component={MyLibrary} />} />
      <Route path="/games"     component={() => <ProtectedRoute component={Games} />} />
      <Route path="/beat"      component={() => <ProtectedRoute component={Beat} />} />
      <Route path="/scripter"  component={() => <ProtectedRoute component={Scripter} />} />
      <Route path="/ai"        component={() => <ProtectedRoute component={AI} />} />
      <Route path="/community"    component={() => <ProtectedRoute component={Community} />} />
      <Route path="/upgrade"      component={() => <ProtectedRoute component={Upgrade} />} />
      <Route path="/admin"        component={() => <ProtectedRoute component={Admin} />} />
      <Route path="/chat"         component={() => <ProtectedRoute component={Chat} />} />

      <Route component={NotFound} />
    </Switch>
  );
}

function ClerkProviderWithRouter() {
  const [, setLocation] = useLocation();
  return (
    <ClerkProvider
      publishableKey={clerkPubKey!}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      afterSignOutUrl={`${basePath}/`}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <HandyProvider>
            <Layout>
              <Router />
            </Layout>
            <Toaster />
          </HandyProvider>
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
