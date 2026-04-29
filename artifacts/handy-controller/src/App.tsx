import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { Layout } from "@/components/layout";

import Home from "@/pages/home";
import Player from "@/pages/player";
import Control from "@/pages/control";
import Library from "@/pages/library";
import Games from "@/pages/games";
import Beat from "@/pages/beat";
import Scripter from "@/pages/scripter";
import AI from "@/pages/ai";

const queryClient = new QueryClient();

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
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Layout>
            <Router />
          </Layout>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
