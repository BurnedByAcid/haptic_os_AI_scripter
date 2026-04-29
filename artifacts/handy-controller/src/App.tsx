import { useEffect, useRef } from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { ClerkProvider } from "@clerk/react";
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
import Community from "@/pages/community";

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
    colorPrimary: "#00E5FF",
    colorForeground: "#F0FFFE",
    colorMutedForeground: "#8CA9AD",
    colorDanger: "#EF4444",
    colorBackground: "#0D1117",
    colorInput: "#161B22",
    colorInputForeground: "#F0FFFE",
    colorNeutral: "#30363D",
    fontFamily: "system-ui, -apple-system, sans-serif",
    borderRadius: "0.75rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "!bg-[#0D1117] border border-[#30363D] rounded-2xl w-[440px] max-w-full overflow-hidden shadow-2xl shadow-[#00E5FF]/5",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-[#0D1117] !rounded-none border-t border-[#30363D]",
    headerTitle: "text-white font-bold",
    headerSubtitle: "text-[#8CA9AD]",
    socialButtonsBlockButtonText: "text-white font-medium",
    socialButtonsBlockButton: "!border-[#30363D] hover:!border-[#00E5FF]/50 !bg-[#161B22] hover:!bg-[#161B22]",
    formFieldLabel: "text-[#8CA9AD] text-sm",
    formFieldInput: "!bg-[#161B22] !border-[#30363D] !text-white focus:!border-[#00E5FF] focus:!ring-1 focus:!ring-[#00E5FF]",
    formButtonPrimary: "!bg-[#00E5FF] !text-black hover:!bg-[#00E5FF]/90 font-bold",
    footerActionLink: "!text-[#00E5FF] hover:!text-[#00E5FF]/80",
    footerActionText: "!text-[#8CA9AD]",
    dividerText: "!text-[#8CA9AD]",
    dividerLine: "!bg-[#30363D]",
    identityPreviewEditButton: "!text-[#00E5FF]",
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

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/player" component={Player} />
      <Route path="/control" component={Control} />
      <Route path="/library" component={Library} />
      <Route path="/games" component={Games} />
      <Route path="/beat" component={Beat} />
      <Route path="/scripter" component={Scripter} />
      <Route path="/ai" component={AI} />
      <Route path="/community" component={Community} />
      <Route path="/sign-in/*?" component={SignInPage} />
      <Route path="/sign-up/*?" component={SignUpPage} />
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
