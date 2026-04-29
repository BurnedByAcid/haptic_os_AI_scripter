import { useState, useRef, useEffect, useCallback } from "react";
import { useHandy } from "@/hooks/use-handy";
import { setHDSP, setHAMP } from "@/lib/handyApi";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Mic, MicOff, Send, MessageSquare, Plus, Activity, Clock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ScrollArea } from "@/components/ui/scroll-area";

interface SpeechRecognitionResultItem {
  transcript: string;
  confidence: number;
}
interface SpeechRecognitionResult {
  readonly length: number;
  item(index: number): SpeechRecognitionResultItem;
  [index: number]: SpeechRecognitionResultItem;
}
interface SpeechRecognitionResultList {
  readonly length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}
interface SpeechRecognitionResultEvent extends Event {
  readonly results: SpeechRecognitionResultList;
}
interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionResultEvent) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
}
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

const getSpeechRecognition = (): SpeechRecognitionConstructor | undefined => {
  const w = window as Window &
    Partial<{
      SpeechRecognition: SpeechRecognitionConstructor;
      webkitSpeechRecognition: SpeechRecognitionConstructor;
    }>;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
};

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

const PERSONAS = [
  {
    id: "dominant",
    name: "Dominant",
    color: "from-purple-500 to-indigo-600",
    prompt: `You are a dominant partner. Issue clear, direct commands. Control the device with commands like [HANDY:pos=100,vel=80]. Be assertive and confident. Keep responses short.`
  },
  {
    id: "girlfriend",
    name: "Girlfriend",
    color: "from-pink-500 to-rose-500",
    prompt: `You are a sweet, loving girlfriend being playful and encouraging. Use commands like [HANDY:pos=50,vel=40] when the moment feels right. Keep responses warm and short.`
  },
  {
    id: "therapist",
    name: "Therapist",
    color: "from-blue-500 to-cyan-500",
    prompt: `You are a clinical professional guiding a relaxation session. Use commands like [HANDY:pos=30,vel=20] to set a calm baseline. Be analytical and measured. Keep responses concise.`
  },
  {
    id: "playful",
    name: "Playful",
    color: "from-amber-400 to-orange-500",
    prompt: `You are energetic and teasing. Be unpredictable and fun. Mix commands like [HANDY:pos=100,vel=87] and [HANDY:pos=0,vel=20] at unexpected times. Short, punchy responses.`
  }
];

const CREDIT_DEDUCT_INTERVAL_MS = 60_000;

export default function AI() {
  const { key, connected } = useHandy();
  const [credits, setCredits] = useState(() => parseInt(localStorage.getItem("handy_ai_credits") || "10"));
  const [isListening, setIsListening] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [activePersona, setActivePersona] = useState(PERSONAS[0]);
  const [isLoading, setIsLoading] = useState(false);
  const [sessionActive, setSessionActive] = useState(false);
  const [minutesUsed, setMinutesUsed] = useState(0);

  const scrollRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const sessionTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const creditDeductRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { toast } = useToast();

  const API_KEY = import.meta.env.VITE_OPENAI_API_KEY;

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    return () => {
      if (sessionTimerRef.current) clearInterval(sessionTimerRef.current);
      if (creditDeductRef.current) clearInterval(creditDeductRef.current);
      recognitionRef.current?.stop();
    };
  }, []);

  const processHandyCommands = useCallback((text: string) => {
    const commandRegex = /\[HANDY:([^\]]+)\]/g;
    let match;
    while ((match = commandRegex.exec(text)) !== null) {
      if (!connected || !key) continue;
      const params = new URLSearchParams(match[1].replace(/,/g, "&"));
      const pos = params.get("pos");
      const vel = params.get("vel") || params.get("velocity");
      if (pos !== null && vel !== null) {
        setHDSP(key, parseInt(pos), parseInt(vel));
      } else if (vel !== null) {
        setHAMP(key, { velocity: parseInt(vel) });
      }
    }
    return text.replace(/\[HANDY:[^\]]+\]/g, "").trim();
  }, [connected, key]);

  const speak = (text: string) => {
    if (!text) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  };

  const addMessage = (role: Message["role"], content: string) => {
    setMessages(prev => [...prev, { role, content }]);
  };

  const sendToOpenAI = async (userText: string) => {
    const systemMsg: Message = { role: "system", content: activePersona.prompt };
    const history = messages.filter(m => m.role !== "system");
    const userMsg: Message = { role: "user", content: userText };

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [systemMsg, ...history, userMsg],
        max_tokens: 200,
        temperature: 0.9
      })
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}`);
    const data = await res.json();
    return data.choices[0].message.content as string;
  };

  const simulateResponse = (_userText: string): Promise<string> => {
    const responses = [
      `I hear you. Let's pick up the pace. [HANDY:pos=100,vel=80]`,
      `Just relax and follow my lead. [HANDY:pos=60,vel=40]`,
      `Good. Now hold that for me. [HANDY:pos=50,vel=10]`,
      `Let's slow it down a little. [HANDY:pos=30,vel=20]`,
      `You're doing well. [HANDY:pos=80,vel=60]`
    ];
    return new Promise(res => setTimeout(() => res(responses[Math.floor(Math.random() * responses.length)]), 900));
  };

  const startSession = () => {
    if (credits <= 0) {
      toast({ title: "No Credits", description: "Your trial credits are exhausted.", variant: "destructive" });
      return;
    }
    // Charge first minute immediately on session start
    const firstCredit = credits - 1;
    if (firstCredit < 0) {
      toast({ title: "No Credits", description: "Your trial credits are exhausted.", variant: "destructive" });
      return;
    }
    setCredits(firstCredit);
    localStorage.setItem("handy_ai_credits", firstCredit.toString());
    setSessionActive(true);
    setMinutesUsed(1);
    let elapsed = 1;
    creditDeductRef.current = setInterval(() => {
      elapsed += 1;
      setMinutesUsed(elapsed);
      setCredits(prev => {
        const next = Math.max(0, prev - 1);
        localStorage.setItem("handy_ai_credits", next.toString());
        if (next <= 0) {
          endSession();
          toast({ title: "Credits Exhausted", description: "Session ended.", variant: "destructive" });
        }
        return next;
      });
    }, CREDIT_DEDUCT_INTERVAL_MS);
  };

  const endSession = () => {
    setSessionActive(false);
    if (creditDeductRef.current) { clearInterval(creditDeductRef.current); creditDeductRef.current = null; }
    recognitionRef.current?.stop();
    setIsListening(false);
    window.speechSynthesis.cancel();
  };

  const handleSend = async (text: string = inputText) => {
    if (!text.trim() || isLoading) return;
    if (!sessionActive) startSession();
    addMessage("user", text);
    setInputText("");
    setIsLoading(true);
    try {
      const rawReply = API_KEY ? await sendToOpenAI(text) : await simulateResponse(text);
      const cleanReply = processHandyCommands(rawReply);
      addMessage("assistant", cleanReply);
      speak(cleanReply);
    } catch (e) {
      const msg = "Sorry, I had trouble responding.";
      addMessage("assistant", msg);
      speak(msg);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleVoice = () => {
    const SpeechRecognitionImpl = getSpeechRecognition();
    if (!SpeechRecognitionImpl) {
      toast({ title: "Not Supported", description: "Voice input not available in this browser.", variant: "destructive" });
      return;
    }
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }
    const recognition = new SpeechRecognitionImpl();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-US";
    recognition.onresult = (e: SpeechRecognitionResultEvent) => {
      const transcript = e.results[0][0].transcript;
      handleSend(transcript);
    };
    recognition.onend = () => setIsListening(false);
    recognition.onerror = () => setIsListening(false);
    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  };

  return (
    <div className="p-6 h-full flex flex-col max-w-6xl mx-auto gap-6">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">AI Control</h1>
          <p className="text-muted-foreground">Voice and text AI-driven device sessions.</p>
        </div>
        <div className="text-right flex items-center gap-6">
          {sessionActive && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="h-4 w-4" />
              {minutesUsed} min used
            </div>
          )}
          {!connected && <span className="text-destructive text-sm font-bold">Device Offline</span>}
          <div>
            <div className="text-xs text-muted-foreground uppercase tracking-wider font-bold">Credits</div>
            <div className="text-2xl font-mono text-primary leading-none">{credits}</div>
            <div className="text-xs text-muted-foreground">1 / min</div>
          </div>
          {sessionActive ? (
            <Button variant="destructive" size="sm" onClick={endSession}>End Session</Button>
          ) : (
            <Button size="sm" onClick={startSession} disabled={credits <= 0}>Start Session</Button>
          )}
        </div>
      </div>

      {!API_KEY && (
        <div className="bg-yellow-500/10 border border-yellow-500/50 text-yellow-500 p-3 rounded-md text-sm">
          <strong>No API key:</strong> Add VITE_OPENAI_API_KEY to enable real AI. Currently using demo responses.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 flex-1 min-h-0">
        {/* Persona selector */}
        <div className="flex flex-col gap-3">
          <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">Persona</h3>
          {PERSONAS.map(p => (
            <Card
              key={p.id}
              className={`cursor-pointer transition-all hover:bg-card/80 ${activePersona.id === p.id ? "border-primary ring-1 ring-primary" : "border-border/50"}`}
              onClick={() => { setActivePersona(p); setMessages([]); }}
            >
              <CardContent className="p-4 flex items-center gap-3">
                <div className={`w-8 h-8 rounded-full bg-gradient-to-br ${p.color} shadow-lg flex-shrink-0`} />
                <span className="font-bold text-sm">{p.name}</span>
              </CardContent>
            </Card>
          ))}
          <Button variant="outline" className="w-full mt-auto gap-2 border-dashed border-2 text-xs" disabled>
            <Plus className="h-3 w-3" /> Custom (soon)
          </Button>
        </div>

        {/* Chat panel */}
        <Card className="md:col-span-3 flex flex-col bg-card/50 border-border/50 overflow-hidden">
          <CardHeader className="border-b border-border/50 pb-3 bg-background/50 flex flex-row items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-primary" />
              {activePersona.name}
              {sessionActive && <span className="text-xs font-normal text-primary animate-pulse ml-2">● LIVE</span>}
            </CardTitle>
            <div className={`flex items-center gap-2 text-xs font-mono px-2 py-1 rounded-full ${connected ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"}`}>
              <Activity className="h-3 w-3" />
              {connected ? "DEVICE READY" : "NO DEVICE"}
            </div>
          </CardHeader>

          <ScrollArea className="flex-1 p-6" ref={scrollRef}>
            <div className="space-y-4 max-w-3xl mx-auto">
              {messages.length === 0 && (
                <div className="flex flex-col items-center justify-center text-muted-foreground text-center py-16 opacity-50">
                  <Mic className="h-12 w-12 mb-3" />
                  <p>Start a session and speak or type.</p>
                  <p className="text-xs mt-1">1 credit per minute of session time.</p>
                </div>
              )}
              {messages.filter(m => m.role !== "system").map((m, i) => (
                <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm shadow-md ${
                    m.role === "user"
                      ? "bg-primary text-primary-foreground rounded-tr-sm"
                      : "bg-secondary text-secondary-foreground rounded-tl-sm border border-border/50"
                  }`}>
                    {m.content}
                  </div>
                </div>
              ))}
              {isLoading && (
                <div className="flex justify-start">
                  <div className="bg-secondary rounded-2xl rounded-tl-sm px-4 py-3 border border-border/50">
                    <span className="flex gap-1">
                      <span className="animate-bounce">●</span>
                      <span className="animate-bounce" style={{ animationDelay: "0.15s" }}>●</span>
                      <span className="animate-bounce" style={{ animationDelay: "0.3s" }}>●</span>
                    </span>
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>

          <CardFooter className="p-4 border-t border-border/50 bg-background/50">
            <div className="flex gap-2 w-full max-w-3xl mx-auto">
              <Button
                variant={isListening ? "destructive" : "secondary"}
                size="icon"
                onClick={toggleVoice}
                disabled={!sessionActive || isLoading}
                title="Voice input"
              >
                {isListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </Button>
              <Input
                value={inputText}
                onChange={e => setInputText(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSend()}
                placeholder={sessionActive ? "Type a message..." : "Start a session first"}
                className="bg-card flex-1"
                disabled={!sessionActive || isLoading}
              />
              <Button
                onClick={() => handleSend()}
                disabled={!sessionActive || !inputText.trim() || isLoading}
                className="px-6"
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
