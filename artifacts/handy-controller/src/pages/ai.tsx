import { useState, useRef, useEffect } from "react";
import { useHandy } from "@/hooks/use-handy";
import { setHDSP, setHAMP } from "@/lib/handyApi";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Mic, MicOff, Send, MessageSquare, Plus, Activity } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ScrollArea } from "@/components/ui/scroll-area";

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

const CHARACTERS = [
  { id: "dominant", name: "Dominant", prompt: "You are a dominant partner. Issue clear, direct commands. Include commands like [HANDY:pos=100,vel=80] to control the device.", color: "from-purple-500 to-indigo-600" },
  { id: "girlfriend", name: "Girlfriend", prompt: "You are a sweet, loving girlfriend. Be gentle and encouraging. Include commands like [HANDY:pos=50,vel=40] occasionally.", color: "from-pink-500 to-rose-500" },
  { id: "therapist", name: "Therapist", prompt: "You are a clinical professional guiding a session. Be analytical. Use commands like [HANDY:velocity=30] to set a baseline.", color: "from-blue-500 to-cyan-500" },
  { id: "playful", name: "Playful", prompt: "You are energetic and teasing. Be unpredictable. Mix up commands randomly like [HANDY:pos=0,vel=87] and [HANDY:pos=100,vel=20].", color: "from-amber-400 to-orange-500" }
];

export default function AI() {
  const { key, connected } = useHandy();
  const [credits, setCredits] = useState(() => parseInt(localStorage.getItem("handy_ai_credits") || "10"));
  const [isRecording, setIsRecording] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [activeChar, setActiveChar] = useState(CHARACTERS[0]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  
  const API_KEY = import.meta.env.VITE_OPENAI_API_KEY;

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const processResponse = (text: string) => {
    // Extract commands: [HANDY:pos=100,vel=80] or [HANDY:velocity=50]
    const commandRegex = /\[HANDY:([^\]]+)\]/g;
    let match;
    let hasCommand = false;

    while ((match = commandRegex.exec(text)) !== null) {
      hasCommand = true;
      if (!connected || !key) continue;

      const paramsStr = match[1];
      const params = new URLSearchParams(paramsStr.replace(/,/g, '&'));
      
      const pos = params.get('pos');
      const vel = params.get('vel') || params.get('velocity');

      if (pos !== null && vel !== null) {
        setHDSP(key, parseInt(pos), parseInt(vel));
      } else if (vel !== null && pos === null) {
        setHAMP(key, { velocity: parseInt(vel) });
      }
    }

    const cleanText = text.replace(commandRegex, '').trim();
    
    setMessages(prev => [...prev, { role: "assistant", content: cleanText }]);

    if (cleanText) {
      const utterance = new SpeechSynthesisUtterance(cleanText);
      window.speechSynthesis.speak(utterance);
    }
    
    if (hasCommand && !connected) {
      toast({ title: "Command Ignored", description: "Device not connected.", variant: "destructive" });
    }
  };

  const simulateAiResponse = (userText: string) => {
    // Simple simulation since we can't make actual external API calls without setup
    setTimeout(() => {
      const responses = [
        `I hear you. Let's pick up the pace. [HANDY:pos=100,vel=80]`,
        `Just relax and follow my lead. [HANDY:velocity=40]`,
        `Good. Now hold that for me. [HANDY:pos=50,vel=10]`,
      ];
      const randomResponse = responses[Math.floor(Math.random() * responses.length)];
      processResponse(randomResponse);
    }, 1000);
  };

  const handleSend = () => {
    if (!inputText.trim()) return;
    
    if (credits <= 0) {
      toast({ title: "No Credits", description: "Credits exhausted.", variant: "destructive" });
      return;
    }
    
    setMessages(prev => [...prev, { role: "user", content: inputText }]);
    const currentInput = inputText;
    setInputText("");
    
    // deduct credit
    const newCreds = credits - 1;
    setCredits(newCreds);
    localStorage.setItem("handy_ai_credits", newCreds.toString());

    simulateAiResponse(currentInput);
  };

  return (
    <div className="p-6 h-full flex flex-col max-w-6xl mx-auto gap-6">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">AI Control</h1>
          <p className="text-muted-foreground">Voice-controlled interactive sessions.</p>
        </div>
        <div className="text-right flex items-center gap-4">
          {!connected && <span className="text-destructive text-sm font-bold">Offline</span>}
          <div>
            <div className="text-sm text-muted-foreground uppercase tracking-wider font-bold">Credits</div>
            <div className="text-2xl font-mono text-primary leading-none">{credits}</div>
          </div>
        </div>
      </div>

      {!API_KEY && (
        <div className="bg-yellow-500/10 border border-yellow-500/50 text-yellow-500 p-4 rounded-md text-sm">
          <strong>Missing API Key:</strong> Add your OpenAI API key as VITE_OPENAI_API_KEY in Replit Secrets to enable real AI. (Currently using simulated responses).
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 flex-1 min-h-0">
        
        <div className="flex flex-col gap-4">
          <h3 className="font-semibold text-lg uppercase tracking-wider text-muted-foreground">Persona</h3>
          {CHARACTERS.map(c => (
            <Card 
              key={c.id} 
              className={`cursor-pointer transition-all hover:bg-card/80 ${activeChar.id === c.id ? 'border-primary ring-1 ring-primary' : 'border-border/50'}`}
              onClick={() => setActiveChar(c)}
            >
              <CardContent className="p-4 flex items-center gap-4">
                <div className={`w-10 h-10 rounded-full bg-gradient-to-br ${c.color} shadow-lg`} />
                <span className="font-bold">{c.name}</span>
              </CardContent>
            </Card>
          ))}
          
          <Button variant="outline" className="w-full mt-auto gap-2 border-dashed border-2">
            <Plus className="h-4 w-4" /> Add Custom
          </Button>
        </div>

        <Card className="md:col-span-3 flex flex-col bg-card/50 border-border/50 overflow-hidden">
          <CardHeader className="border-b border-border/50 pb-4 bg-background/50 flex flex-row items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-primary" /> Session with {activeChar.name}
            </CardTitle>
            <div className={`flex items-center gap-2 text-xs font-mono px-2 py-1 rounded-full ${connected ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'}`}>
              <Activity className="h-3 w-3" />
              {connected ? 'DEVICE READY' : 'NO DEVICE'}
            </div>
          </CardHeader>
          
          <ScrollArea className="flex-1 p-6" ref={scrollRef}>
            <div className="space-y-6 max-w-3xl mx-auto">
              {messages.length === 0 && (
                <div className="flex flex-col items-center justify-center text-muted-foreground text-center py-20 opacity-50">
                  <Mic className="h-16 w-16 mb-4" />
                  <p className="text-lg">Send a message to begin.</p>
                  <p className="text-sm">1 message = 1 credit.</p>
                </div>
              )}
              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] rounded-2xl px-5 py-3 shadow-md ${
                    m.role === 'user' 
                      ? 'bg-primary text-primary-foreground rounded-tr-sm' 
                      : 'bg-secondary text-secondary-foreground rounded-tl-sm border border-border/50'
                  }`}>
                    {m.content}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>

          <CardFooter className="p-4 border-t border-border/50 bg-background/50">
            <div className="flex gap-2 w-full max-w-3xl mx-auto">
              <Input 
                value={inputText}
                onChange={e => setInputText(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSend()}
                placeholder="Type a message..."
                className="bg-card flex-1"
                disabled={credits <= 0}
              />
              <Button 
                onClick={handleSend}
                disabled={credits <= 0 || !inputText.trim()}
                className="px-8"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </CardFooter>
        </Card>

      </div>
    </div>
  );
}
