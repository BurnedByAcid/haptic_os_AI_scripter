import { Link, useLocation } from "wouter";
import { useHandy } from "@/hooks/use-handy";
import { Activity, Gamepad2, Home, Library, Mic, PlaySquare, Settings2, Sparkles } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: Home },
  { href: "/player", label: "Player", icon: PlaySquare },
  { href: "/control", label: "Control", icon: Settings2 },
  { href: "/library", label: "Library", icon: Library },
  { href: "/games", label: "Games", icon: Gamepad2 },
  { href: "/beat", label: "Beat 2 Beat", icon: Activity },
  { href: "/scripter", label: "Scripter", icon: Mic },
  { href: "/ai", label: "AI Control", icon: Sparkles },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { key, updateKey, connected, checking, battery } = useHandy();
  const [inputKey, setInputKey] = useState(key);
  const { toast } = useToast();

  const handleSaveKey = () => {
    updateKey(inputKey);
    toast({
      title: "Key updated",
      description: "Attempting to connect to Handy..."
    });
  };

  return (
    <div className="flex h-screen w-full bg-background text-foreground overflow-hidden">
      {/* Sidebar */}
      <div className="w-64 border-r border-border bg-card flex flex-col flex-shrink-0">
        <div className="p-4 border-b border-border">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-xl font-bold tracking-tight text-primary">HANDY<span className="text-foreground">CTRL</span></h1>
            <div className="flex items-center gap-2">
              {battery !== undefined && connected && (
                <span className="text-xs font-mono text-muted-foreground">{battery}%</span>
              )}
              <div
                className={`h-3 w-3 rounded-full ${
                  checking ? "bg-yellow-500 animate-pulse" :
                  connected ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]" :
                  "bg-red-500"
                }`}
                title={checking ? "Checking..." : connected ? `Connected${battery !== undefined ? ` · ${battery}% battery` : ""}` : "Disconnected"}
              />
            </div>
          </div>
          
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Connection Key</label>
            <div className="flex gap-2">
              <Input 
                type="password" 
                value={inputKey} 
                onChange={e => setInputKey(e.target.value)}
                placeholder="Key..."
                className="h-8 text-xs font-mono"
                data-testid="input-connection-key"
              />
              <Button size="sm" onClick={handleSaveKey} className="h-8 px-3" data-testid="button-save-key">
                Save
              </Button>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto py-4">
          <nav className="space-y-1 px-2">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = location === item.href;
              return (
                <Link key={item.href} href={item.href}>
                  <div 
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-md cursor-pointer transition-colors ${
                      isActive 
                        ? "bg-primary/10 text-primary font-medium" 
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                    data-testid={`link-${item.label.toLowerCase().replace(/\s+/g, '-')}`}
                  >
                    <Icon size={18} />
                    <span className="text-sm">{item.label}</span>
                  </div>
                </Link>
              );
            })}
          </nav>
        </div>
      </div>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden bg-background">
        <div className="flex-1 overflow-y-auto">
          {children}
        </div>
      </main>
    </div>
  );
}
