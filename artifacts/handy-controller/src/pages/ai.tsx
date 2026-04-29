import { useState, useRef, useEffect, useCallback } from "react";
import { useHandy } from "@/hooks/use-handy";
import { setHDSP, setHAMP } from "@/lib/handyApi";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Mic, MicOff, Send, MessageSquare, Plus, Clock, Radio, StopCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ScrollArea } from "@/components/ui/scroll-area";

// ── Speech Recognition (browser API, no TS lib) ────────────────────────────
interface SpeechRecognitionResultItem { transcript: string; confidence: number; }
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
  const w = window as Window & Partial<{
    SpeechRecognition: SpeechRecognitionConstructor;
    webkitSpeechRecognition: SpeechRecognitionConstructor;
  }>;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
};

// ── Realtime helpers ────────────────────────────────────────────────────────
function float32ToInt16(f32: Float32Array): Int16Array {
  const i16 = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    i16[i] = Math.max(-32768, Math.min(32767, Math.round(f32[i] * 32768)));
  }
  return i16;
}
function arrayBufferToBase64(buf: ArrayBufferLike): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function base64ToFloat32(b64: string): Float32Array {
  const binary = atob(b64);
  const buf = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const i16 = new Int16Array(buf);
  const f32 = new Float32Array(i16.length);
  for (let i = 0; i < i16.length; i++) f32[i] = i16[i] / 32768;
  return f32;
}

// ── Personas ───────────────────────────────────────────────────────────────
interface Message { role: "user" | "assistant"; content: string; }
const PERSONAS = [
  { id: "dominant", name: "Dominant", color: "from-purple-500 to-indigo-600",
    prompt: "You are a dominant partner. Issue short, direct commands. Control the device with inline commands like [HANDY:pos=100,vel=80]. Be assertive. Keep responses under 30 words." },
  { id: "girlfriend", name: "Girlfriend", color: "from-pink-500 to-rose-500",
    prompt: "You are a sweet, loving girlfriend being playful. Use commands like [HANDY:pos=50,vel=40] when the moment feels right. Warm, short responses under 30 words." },
  { id: "therapist", name: "Therapist", color: "from-blue-500 to-cyan-500",
    prompt: "You are a clinical professional guiding a relaxation session. Use commands like [HANDY:pos=30,vel=20] to set a calm baseline. Measured, concise responses under 30 words." },
  { id: "playful", name: "Playful", color: "from-amber-400 to-orange-500",
    prompt: "You are energetic and teasing. Mix commands like [HANDY:pos=100,vel=87] and [HANDY:pos=0,vel=20] unpredictably. Punchy responses under 25 words." }
];

const CREDIT_DEDUCT_INTERVAL_MS = 60_000;
const RT_MODEL = "gpt-4o-realtime-preview";
const RT_URL = `wss://api.openai.com/v1/realtime?model=${RT_MODEL}`;

export default function AI() {
  const { key, connected } = useHandy();
  const [credits, setCredits] = useState(() => parseInt(localStorage.getItem("handy_ai_credits") || "10"));
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [activePersona, setActivePersona] = useState(PERSONAS[0]);
  const [isLoading, setIsLoading] = useState(false);
  const [sessionActive, setSessionActive] = useState(false);
  const [minutesUsed, setMinutesUsed] = useState(0);
  const [isListening, setIsListening] = useState(false);
  const [isMicStreaming, setIsMicStreaming] = useState(false);
  const [rtConnected, setRtConnected] = useState(false);
  const [apiKey, setApiKey] = useState(() =>
    localStorage.getItem("handy_openai_key") || import.meta.env.VITE_OPENAI_API_KEY || ""
  );
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [keyDraft, setKeyDraft] = useState("");
  const [transcriptBuffer, setTranscriptBuffer] = useState("");

  const scrollRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const playbackTimeRef = useRef(0);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const creditDeductRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, transcriptBuffer]);

  useEffect(() => {
    return () => {
      stopSession();
    };
  }, []);

  // ── HANDY command parser ─────────────────────────────────────────────────
  const processHandyCommands = useCallback((text: string) => {
    const regex = /\[HANDY:([^\]]+)\]/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      if (!connected || !key) continue;
      const params = new URLSearchParams(match[1].replace(/,/g, "&"));
      const pos = params.get("pos");
      const vel = params.get("vel") ?? params.get("velocity");
      if (pos !== null && vel !== null) setHDSP(key, parseInt(pos), parseInt(vel));
      else if (vel !== null) setHAMP(key, { velocity: parseInt(vel) });
    }
    return text.replace(/\[HANDY:[^\]]+\]/g, "").trim();
  }, [connected, key]);

  // ── Credit management ────────────────────────────────────────────────────
  const deductCreditsStart = () => {
    const firstCredit = credits - 1;
    if (firstCredit < 0) {
      toast({ title: "No Credits", description: "Trial credits exhausted.", variant: "destructive" });
      return false;
    }
    setCredits(firstCredit);
    localStorage.setItem("handy_ai_credits", firstCredit.toString());
    setMinutesUsed(1);
    let elapsed = 1;
    creditDeductRef.current = setInterval(() => {
      elapsed++;
      setMinutesUsed(elapsed);
      setCredits(prev => {
        const next = Math.max(0, prev - 1);
        localStorage.setItem("handy_ai_credits", next.toString());
        if (next <= 0) { stopSession(); toast({ title: "Credits Exhausted", variant: "destructive" }); }
        return next;
      });
    }, CREDIT_DEDUCT_INTERVAL_MS);
    return true;
  };

  // ── Audio playback (PCM16 @ 24kHz) ────────────────────────────────────────
  const playPCM16Chunk = useCallback((base64: string) => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext({ sampleRate: 24000 });
      playbackTimeRef.current = 0;
    }
    const ctx = audioCtxRef.current;
    const f32 = base64ToFloat32(base64);
    if (f32.length === 0) return;
    const buf = ctx.createBuffer(1, f32.length, 24000);
    buf.copyToChannel(new Float32Array(f32), 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    const startAt = Math.max(ctx.currentTime, playbackTimeRef.current);
    src.start(startAt);
    playbackTimeRef.current = startAt + buf.duration;
  }, []);

  // ── Realtime WebSocket ───────────────────────────────────────────────────
  const startRealtimeSession = useCallback(async () => {
    if (!apiKey) {
      toast({ title: "No API Key", description: "Set your OpenAI API key first.", variant: "destructive" });
      setShowKeyInput(true);
      return;
    }
    if (credits <= 0) {
      toast({ title: "No Credits", description: "Trial credits exhausted.", variant: "destructive" });
      return;
    }

    audioCtxRef.current = new AudioContext({ sampleRate: 24000 });
    playbackTimeRef.current = 0;

    const ws = new WebSocket(RT_URL, [
      "realtime",
      `openai-insecure-api-key.${apiKey}`,
      "openai-beta.realtime-v1"
    ]);
    wsRef.current = ws;

    ws.onopen = async () => {
      ws.send(JSON.stringify({
        type: "session.update",
        session: {
          modalities: ["audio", "text"],
          instructions: activePersona.prompt,
          voice: "alloy",
          input_audio_format: "pcm16",
          output_audio_format: "pcm16",
          input_audio_transcription: { model: "whisper-1" },
          turn_detection: { type: "server_vad", threshold: 0.5, silence_duration_ms: 800, prefix_padding_ms: 300 }
        }
      }));
      setRtConnected(true);
      setSessionActive(true);
      deductCreditsStart();
      startMicStreaming(ws);
    };

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data as string) as { type: string; [k: string]: unknown };
        handleRealtimeEvent(msg);
      } catch { /* ignore parse error */ }
    };

    ws.onclose = () => {
      setRtConnected(false);
      setIsMicStreaming(false);
    };

    ws.onerror = () => {
      toast({ title: "Connection Failed", description: "Could not connect to OpenAI Realtime API. Check your API key.", variant: "destructive" });
      stopSession();
    };
  }, [apiKey, activePersona, credits, playPCM16Chunk]);

  const handleRealtimeEvent = useCallback((msg: { type: string; [k: string]: unknown }) => {
    switch (msg.type) {
      case "response.audio.delta":
        if (typeof msg.delta === "string") playPCM16Chunk(msg.delta);
        break;
      case "response.audio_transcript.delta":
        if (typeof msg.delta === "string")
          setTranscriptBuffer(prev => prev + msg.delta);
        break;
      case "response.audio_transcript.done":
      case "response.text.done": {
        const text = (msg.transcript ?? msg.text ?? "") as string;
        if (text) {
          const clean = processHandyCommands(text);
          setMessages(prev => [...prev, { role: "assistant", content: clean }]);
          setTranscriptBuffer("");
        }
        break;
      }
      case "conversation.item.input_audio_transcription.completed": {
        const transcript = (msg.transcript ?? "") as string;
        if (transcript) setMessages(prev => [...prev, { role: "user", content: transcript }]);
        break;
      }
      case "error":
        console.error("Realtime error:", msg);
        break;
    }
  }, [processHandyCommands, playPCM16Chunk]);

  const startMicStreaming = async (ws: WebSocket) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { sampleRate: 24000, channelCount: 1 } });
      micStreamRef.current = stream;
      const ctx = audioCtxRef.current ?? new AudioContext({ sampleRate: 24000 });
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(2048, 1, 1);
      processorRef.current = processor;
      source.connect(processor);
      processor.connect(ctx.destination);
      processor.onaudioprocess = (e) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        const f32 = e.inputBuffer.getChannelData(0);
        const i16 = float32ToInt16(f32);
        const b64 = arrayBufferToBase64(i16.buffer);
        ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: b64 }));
      };
      setIsMicStreaming(true);
    } catch {
      toast({ title: "Mic Access Denied", description: "Could not access microphone.", variant: "destructive" });
    }
  };

  const stopSession = useCallback(() => {
    if (creditDeductRef.current) { clearInterval(creditDeductRef.current); creditDeductRef.current = null; }
    if (processorRef.current) { processorRef.current.disconnect(); processorRef.current = null; }
    if (micStreamRef.current) { micStreamRef.current.getTracks().forEach(t => t.stop()); micStreamRef.current = null; }
    if (audioCtxRef.current) { audioCtxRef.current.close().catch(() => {}); audioCtxRef.current = null; }
    if (wsRef.current && wsRef.current.readyState <= WebSocket.OPEN) { wsRef.current.close(); wsRef.current = null; }
    recognitionRef.current?.stop();
    setSessionActive(false);
    setRtConnected(false);
    setIsMicStreaming(false);
    setIsListening(false);
    setTranscriptBuffer("");
  }, []);

  // ── Fallback text send (when no Realtime or no mic) ──────────────────────
  const simulateResponse = (_text: string): Promise<string> => {
    const r = [
      "I hear you. Let's pick up the pace. [HANDY:pos=100,vel=80]",
      "Just relax and follow my lead. [HANDY:pos=60,vel=40]",
      "Good. Now hold that for me. [HANDY:pos=50,vel=10]",
      "Let's slow it down. [HANDY:pos=30,vel=20]",
      "You're doing well. [HANDY:pos=80,vel=60]"
    ];
    return new Promise(res => setTimeout(() => res(r[Math.floor(Math.random() * r.length)]), 900));
  };

  const sendTextViaRealtime = (text: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({
      type: "conversation.item.create",
      item: { type: "message", role: "user", content: [{ type: "input_text", text }] }
    }));
    wsRef.current.send(JSON.stringify({
      type: "response.create",
      response: { modalities: ["audio", "text"], max_output_tokens: 150 }
    }));
  };

  const handleSend = async (text: string = inputText) => {
    if (!text.trim() || isLoading) return;
    setMessages(prev => [...prev, { role: "user", content: text }]);
    setInputText("");

    if (rtConnected && wsRef.current) {
      sendTextViaRealtime(text);
      return;
    }

    // Fallback: Chat Completions or simulation
    if (!sessionActive) { if (!deductCreditsStart()) return; setSessionActive(true); }
    setIsLoading(true);
    try {
      let rawReply: string;
      if (apiKey) {
        const res = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            messages: [
              { role: "system", content: activePersona.prompt },
              ...messages.slice(-10),
              { role: "user", content: text }
            ],
            max_tokens: 200, temperature: 0.9
          })
        });
        if (!res.ok) throw new Error(`OpenAI ${res.status}`);
        const data = await res.json() as { choices: { message: { content: string } }[] };
        rawReply = data.choices[0].message.content;
      } else {
        rawReply = await simulateResponse(text);
      }
      const clean = processHandyCommands(rawReply);
      setMessages(prev => [...prev, { role: "assistant", content: clean }]);
      const u = new SpeechSynthesisUtterance(clean);
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch {
      setMessages(prev => [...prev, { role: "assistant", content: "Sorry, I had trouble responding." }]);
    } finally {
      setIsLoading(false);
    }
  };

  // ── Browser SpeechRecognition for fallback ────────────────────────────────
  const toggleVoice = () => {
    const SpeechRecognitionImpl = getSpeechRecognition();
    if (!SpeechRecognitionImpl) {
      toast({ title: "Not Supported", description: "Voice input not available in this browser.", variant: "destructive" });
      return;
    }
    if (isListening) { recognitionRef.current?.stop(); setIsListening(false); return; }
    const recognition = new SpeechRecognitionImpl();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-US";
    recognition.onresult = (e: SpeechRecognitionResultEvent) => handleSend(e.results[0][0].transcript);
    recognition.onend = () => setIsListening(false);
    recognition.onerror = () => setIsListening(false);
    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  };

  const saveApiKey = (k: string) => {
    const trimmed = k.trim();
    setApiKey(trimmed);
    if (trimmed) localStorage.setItem("handy_openai_key", trimmed);
    else localStorage.removeItem("handy_openai_key");
    setShowKeyInput(false);
    setKeyDraft("");
    toast({ title: trimmed ? "API Key Saved" : "API Key Cleared", description: trimmed ? "Real-time voice AI enabled." : "Switched to simulation." });
  };

  return (
    <div className="p-6 h-full flex flex-col max-w-6xl mx-auto gap-4">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">AI Control</h1>
          <p className="text-muted-foreground">OpenAI Realtime voice sessions with device sync.</p>
        </div>
        <div className="text-right flex items-center gap-6">
          {sessionActive && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="h-4 w-4" />{minutesUsed} min
            </div>
          )}
          {!connected && <span className="text-destructive text-sm font-bold">Device Offline</span>}
          <div>
            <div className="text-xs text-muted-foreground uppercase tracking-wider font-bold">Credits</div>
            <div className="text-2xl font-mono text-primary leading-none">{credits}</div>
            <div className="text-xs text-muted-foreground">1 / min</div>
          </div>
          {sessionActive ? (
            <Button variant="destructive" size="sm" onClick={stopSession} className="gap-2">
              <StopCircle className="h-4 w-4" /> End Session
            </Button>
          ) : (
            <Button size="sm" onClick={startRealtimeSession} disabled={credits <= 0} className="gap-2">
              <Radio className="h-4 w-4" /> Start Realtime
            </Button>
          )}
        </div>
      </div>

      {/* API Key bar */}
      <div className="flex items-center gap-3 bg-card/50 border border-border/50 rounded-lg px-4 py-2">
        <span className={`text-xs font-bold px-2 py-1 rounded ${rtConnected ? "bg-green-500/20 text-green-400" : apiKey ? "bg-blue-500/20 text-blue-400" : "bg-yellow-500/20 text-yellow-400"}`}>
          {rtConnected ? "Realtime Connected" : apiKey ? "API Key Set" : "Simulation Mode"}
        </span>
        {isMicStreaming && (
          <span className="flex items-center gap-1 text-xs text-green-400 font-bold animate-pulse">
            <Mic className="h-3 w-3" /> Mic Streaming
          </span>
        )}
        {showKeyInput ? (
          <>
            <Input type="password" placeholder="sk-..." value={keyDraft}
              onChange={e => setKeyDraft(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") saveApiKey(keyDraft); if (e.key === "Escape") setShowKeyInput(false); }}
              className="h-7 flex-1 text-xs bg-background" autoFocus
            />
            <Button size="sm" className="h-7 text-xs px-3" onClick={() => saveApiKey(keyDraft)}>Save</Button>
            {apiKey && <Button size="sm" variant="destructive" className="h-7 text-xs px-3" onClick={() => saveApiKey("")}>Clear</Button>}
            <Button size="sm" variant="ghost" className="h-7 text-xs px-3" onClick={() => setShowKeyInput(false)}>Cancel</Button>
          </>
        ) : (
          <>
            <span className="text-xs text-muted-foreground flex-1">
              {apiKey ? "OpenAI key set — voice sessions use the Realtime API." : "Enter your OpenAI key to enable real-time AI voice."}
            </span>
            <Button size="sm" variant="outline" className="h-7 text-xs px-3" onClick={() => { setShowKeyInput(true); setKeyDraft(""); }}>
              {apiKey ? "Change Key" : "Set API Key"}
            </Button>
          </>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 flex-1 min-h-0">
        {/* Persona selector */}
        <div className="flex flex-col gap-3">
          <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">Persona</h3>
          {PERSONAS.map(p => (
            <Card
              key={p.id}
              className={`cursor-pointer transition-all hover:bg-card/80 ${activePersona.id === p.id ? "border-primary ring-1 ring-primary" : "border-border/50"}`}
              onClick={() => { if (!sessionActive) { setActivePersona(p); setMessages([]); } }}
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

        {/* Chat area */}
        <div className="md:col-span-3 flex flex-col gap-3 min-h-0">
          <Card className="flex-1 bg-card/30 border-border/50 flex flex-col min-h-0">
            <CardHeader className="pb-2 border-b border-border/50 flex-row items-center gap-3">
              <MessageSquare className="h-4 w-4 text-primary" />
              <CardTitle className="text-sm">{activePersona.name}</CardTitle>
              {rtConnected && <span className="ml-auto flex items-center gap-1 text-xs text-green-400"><span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />Live</span>}
            </CardHeader>
            <ScrollArea className="flex-1 p-4" ref={scrollRef as React.RefObject<HTMLDivElement>}>
              {messages.length === 0 && !transcriptBuffer && (
                <div className="h-full flex flex-col items-center justify-center text-muted-foreground text-center py-12 gap-3">
                  <Mic className="h-12 w-12 opacity-20" />
                  <p className="text-sm">{sessionActive ? "Speak — the AI is listening." : "Start a session to begin."}</p>
                  <p className="text-xs opacity-60">1 credit per minute · {credits} remaining</p>
                </div>
              )}
              <div className="space-y-3">
                {messages.map((m, i) => (
                  <div key={i} className={`flex gap-3 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[85%] px-3 py-2 rounded-xl text-sm ${m.role === "user" ? "bg-primary text-primary-foreground" : "bg-card border border-border/50"}`}>
                      {m.content}
                    </div>
                  </div>
                ))}
                {transcriptBuffer && (
                  <div className="flex gap-3 justify-start">
                    <div className="max-w-[85%] px-3 py-2 rounded-xl text-sm bg-card border border-primary/40 text-primary/80 italic">
                      {transcriptBuffer}<span className="animate-pulse">▌</span>
                    </div>
                  </div>
                )}
                {isLoading && (
                  <div className="flex gap-3 justify-start">
                    <div className="px-3 py-2 rounded-xl text-sm bg-card border border-border/50 text-muted-foreground italic">Thinking…</div>
                  </div>
                )}
              </div>
            </ScrollArea>
          </Card>

          {/* Text input fallback */}
          <div className="flex gap-2">
            <Button
              variant={isListening ? "destructive" : "outline"}
              size="icon"
              className="flex-shrink-0"
              onClick={toggleVoice}
              disabled={sessionActive && rtConnected}
              title={sessionActive && rtConnected ? "Mic streaming via Realtime API" : "Push-to-talk"}
            >
              {isListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </Button>
            <Input
              value={inputText}
              onChange={e => setInputText(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              placeholder={sessionActive ? "Or type a message…" : "Start a session first"}
              disabled={!sessionActive || isLoading}
              className="bg-card border-border/50"
            />
            <Button size="icon" onClick={() => handleSend()} disabled={!sessionActive || !inputText.trim() || isLoading} className="flex-shrink-0">
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
