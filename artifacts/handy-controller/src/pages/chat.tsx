import { useState, useRef, useEffect, useCallback } from "react";
import { useAuth } from "@clerk/react";
import { useSubscription } from "@/hooks/use-subscription";
import { PremiumGate } from "@/components/premium-gate";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import {
  MessageSquare, Plus, Trash2, Pencil, Check, X, ChevronDown,
  Copy, RefreshCw, Bot, User, Upload, AlertCircle, Loader2,
  UserCircle, Sparkles, HelpCircle, Theater, Settings
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

const API_BASE = import.meta.env.VITE_API_URL ?? "";

type ChatMode = "general" | "app-help" | "roleplay";

interface Persona {
  id: number;
  name: string;
  avatar_url: string | null;
  description: string;
  personality: string;
  scenario: string;
  greeting: string;
  example_dialogue: string;
  source: string;
}

interface Conversation {
  id: number;
  title: string;
  mode: ChatMode;
  persona_id: number | null;
  persona_name: string | null;
  updated_at: string;
}

interface ChatMessage {
  id: number;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
}

const MODE_CONFIG: Record<ChatMode, { label: string; icon: typeof Sparkles; desc: string }> = {
  general:    { label: "General",  icon: Sparkles,    desc: "Open-ended conversation" },
  "app-help": { label: "App Help", icon: HelpCircle,  desc: "HapticOS support assistant" },
  roleplay:   { label: "Roleplay", icon: Theater,     desc: "Character persona chat" },
};

function useAuthFetch() {
  const { getToken } = useAuth();
  return useCallback(async (url: string, opts: RequestInit = {}) => {
    const token = await getToken();
    const headers: Record<string, string> = {
      ...(opts.headers as Record<string, string>),
    };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    if (!headers["Content-Type"] && opts.method && opts.method !== "GET") {
      headers["Content-Type"] = "application/json";
    }
    return fetch(`${API_BASE}${url}`, { ...opts, headers });
  }, [getToken]);
}

function PersonaAvatar({ persona, size = "sm" }: { persona: Persona; size?: "sm" | "lg" }) {
  const dim = size === "lg" ? "h-14 w-14 text-2xl" : "h-8 w-8 text-sm";
  if (persona.avatar_url) {
    return <img src={persona.avatar_url} alt={persona.name} className={`${dim} rounded-full object-cover border border-border`} />;
  }
  return (
    <div className={`${dim} rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center font-bold text-primary flex-shrink-0`}>
      {persona.name[0]?.toUpperCase()}
    </div>
  );
}

const BLANK_PERSONA_FORM = {
  name: "", avatarUrl: "", description: "", personality: "", scenario: "", greeting: "", exampleDialogue: ""
};

export default function ChatPage() {
  const { isPro, isLoaded } = useSubscription();
  const authFetch = useAuthFetch();
  const { toast } = useToast();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [personas, setPersonas] = useState<Persona[]>([]);

  const [renamingConvId, setRenamingConvId] = useState<number | null>(null);
  const [renameInput, setRenameInput] = useState("");

  const [streaming, setStreaming] = useState(false);
  const [streamContent, setStreamContent] = useState("");
  const [composer, setComposer] = useState("");
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [loadingConvs, setLoadingConvs] = useState(true);
  const [ollamaMissing, setOllamaCheckDone] = useState(false);

  const [showPersonaManager, setShowPersonaManager] = useState(false);
  const [editingPersona, setEditingPersona] = useState<Persona | null>(null);
  const [personaForm, setPersonaForm] = useState(BLANK_PERSONA_FORM);
  const [savingPersona, setSavingPersona] = useState(false);
  const [importingCard, setImportingCard] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importJson, setImportJson] = useState("");

  const [copiedMsgId, setCopiedMsgId] = useState<number | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeConv = conversations.find(c => c.id === activeConvId) ?? null;

  useEffect(() => {
    if (!isLoaded || !isPro) return;
    fetchConversations();
    fetchPersonas();
  }, [isLoaded, isPro]);

  useEffect(() => {
    if (activeConvId === null) return;
    fetchMessages(activeConvId);
  }, [activeConvId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamContent]);

  async function fetchConversations() {
    setLoadingConvs(true);
    try {
      const res = await authFetch("/api/chat/conversations");
      if (res.ok) {
        const data = await res.json() as Conversation[];
        setConversations(data);
        if (data.length > 0 && activeConvId === null) {
          setActiveConvId(data[0].id);
        }
      }
    } catch { /* ignore */ } finally {
      setLoadingConvs(false);
    }
  }

  async function fetchPersonas() {
    try {
      const res = await authFetch("/api/chat/personas");
      if (res.ok) setPersonas(await res.json() as Persona[]);
    } catch { /* ignore */ }
  }

  async function fetchMessages(convId: number) {
    setLoadingMsgs(true);
    setMessages([]);
    try {
      const res = await authFetch(`/api/chat/conversations/${convId}/messages`);
      if (res.ok) setMessages(await res.json() as ChatMessage[]);
    } catch { /* ignore */ } finally {
      setLoadingMsgs(false);
    }
  }

  async function createConversation() {
    try {
      const res = await authFetch("/api/chat/conversations", {
        method: "POST",
        body: JSON.stringify({ title: "New Chat", mode: "general" }),
      });
      if (res.ok) {
        const conv = await res.json() as Conversation;
        setConversations(prev => [conv, ...prev]);
        setActiveConvId(conv.id);
        setMessages([]);
      }
    } catch { toast({ title: "Failed to create chat", variant: "destructive" }); }
  }

  async function deleteConversation(id: number) {
    try {
      await authFetch(`/api/chat/conversations/${id}`, { method: "DELETE" });
      setConversations(prev => prev.filter(c => c.id !== id));
      if (activeConvId === id) {
        const remaining = conversations.filter(c => c.id !== id);
        setActiveConvId(remaining[0]?.id ?? null);
        setMessages([]);
      }
    } catch { toast({ title: "Failed to delete chat", variant: "destructive" }); }
  }

  async function renameConversation(id: number, title: string) {
    try {
      const res = await authFetch(`/api/chat/conversations/${id}`, {
        method: "PUT",
        body: JSON.stringify({ title }),
      });
      if (res.ok) {
        setConversations(prev => prev.map(c => c.id === id ? { ...c, title } : c));
      }
    } catch { /* ignore */ }
    setRenamingConvId(null);
  }

  async function updateConvMode(mode: ChatMode, personaId?: number | null) {
    if (!activeConvId) return;
    const update: Record<string, unknown> = { mode };
    if (personaId !== undefined) update.personaId = personaId;
    try {
      const res = await authFetch(`/api/chat/conversations/${activeConvId}`, {
        method: "PUT",
        body: JSON.stringify(update),
      });
      if (res.ok) {
        const updated = await res.json() as Conversation;
        setConversations(prev => prev.map(c => c.id === activeConvId ? {
          ...c,
          mode: updated.mode,
          persona_id: updated.persona_id,
          persona_name: personas.find(p => p.id === updated.persona_id)?.name ?? null,
        } : c));
      }
    } catch { /* ignore */ }
  }

  async function sendMessage() {
    if (!composer.trim() || streaming || !activeConvId) return;
    const text = composer.trim();
    setComposer("");

    const tempUserMsg: ChatMessage = {
      id: -Date.now(), role: "user", content: text, created_at: new Date().toISOString()
    };
    setMessages(prev => [...prev, tempUserMsg]);

    setStreaming(true);
    setStreamContent("");
    setOllamaCheckDone(false);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const ollamaUrl = localStorage.getItem("handy_ollama_url") || "http://localhost:11434";
    const ollamaModel = localStorage.getItem("handy_ollama_model") || "llama3";

    try {
      const token = await (async () => {
        const res = await authFetch("/api/chat/send", {
          method: "POST",
          body: JSON.stringify({ conversationId: activeConvId, message: text, ollamaUrl, ollamaModel }),
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) {
          const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` })) as { error?: string };
          throw new Error(err.error ?? `HTTP ${res.status}`);
        }
        return res;
      })();

      const reader = token.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let finalContent = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data: ")) continue;
          const data = trimmed.slice(6);
          try {
            const parsed = JSON.parse(data) as { token?: string; done?: boolean; error?: string };
            if (parsed.error) {
              if (parsed.error.includes("Cannot reach Ollama") || parsed.error.includes("ollama")) {
                setOllamaCheckDone(true);
              }
              throw new Error(parsed.error);
            }
            if (parsed.token) {
              finalContent += parsed.token;
              setStreamContent(finalContent);
            }
            if (parsed.done) {
              const assistantMsg: ChatMessage = {
                id: -Date.now() - 1, role: "assistant", content: finalContent, created_at: new Date().toISOString()
              };
              setMessages(prev => [...prev, assistantMsg]);
              setStreamContent("");
              setConversations(prev => prev.map(c => c.id === activeConvId ? { ...c, updated_at: new Date().toISOString() } : c));
              await fetchMessages(activeConvId);
            }
          } catch (e) {
            if (e instanceof Error && e.message !== "JSON parse failed") {
              setMessages(prev => [...prev, {
                id: -Date.now() - 2, role: "assistant",
                content: `Error: ${e.message}`,
                created_at: new Date().toISOString()
              }]);
              setStreamContent("");
              break;
            }
          }
        }
      }
    } catch (e) {
      if ((e as Error)?.name !== "AbortError") {
        const msg = e instanceof Error ? e.message : "Failed to send message";
        if (msg.includes("Cannot reach Ollama") || msg.includes("ollama")) {
          setOllamaCheckDone(true);
        }
        setMessages(prev => [...prev, {
          id: -Date.now() - 3, role: "assistant",
          content: `Error: ${msg}`,
          created_at: new Date().toISOString()
        }]);
        setStreamContent("");
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
      composerRef.current?.focus();
    }
  }

  async function deleteMessage(id: number) {
    try {
      await authFetch(`/api/chat/messages/${id}`, { method: "DELETE" });
      setMessages(prev => prev.filter(m => m.id !== id));
    } catch { /* ignore */ }
  }

  async function copyMessage(id: number, content: string) {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedMsgId(id);
      setTimeout(() => setCopiedMsgId(null), 2000);
    } catch { /* ignore */ }
  }

  async function regenerateLast() {
    const lastUser = [...messages].reverse().find(m => m.role === "user");
    if (!lastUser || streaming) return;
    const lastAssistant = [...messages].reverse().find(m => m.role === "assistant");
    if (lastAssistant && lastAssistant.id > 0) {
      await deleteMessage(lastAssistant.id);
      setMessages(prev => prev.filter(m => m.id !== lastAssistant.id));
    }
    setComposer(lastUser.content);
    setTimeout(() => sendMessage(), 50);
  }

  async function savePersona() {
    if (!personaForm.name.trim()) return;
    setSavingPersona(true);
    try {
      const body = {
        name: personaForm.name,
        avatarUrl: personaForm.avatarUrl,
        description: personaForm.description,
        personality: personaForm.personality,
        scenario: personaForm.scenario,
        greeting: personaForm.greeting,
        exampleDialogue: personaForm.exampleDialogue,
      };
      const res = editingPersona
        ? await authFetch(`/api/chat/personas/${editingPersona.id}`, { method: "PUT", body: JSON.stringify(body) })
        : await authFetch("/api/chat/personas", { method: "POST", body: JSON.stringify(body) });
      if (res.ok) {
        await fetchPersonas();
        setEditingPersona(null);
        setPersonaForm(BLANK_PERSONA_FORM);
        toast({ title: editingPersona ? "Persona updated" : "Persona created" });
      }
    } catch { toast({ title: "Failed to save persona", variant: "destructive" }); }
    finally { setSavingPersona(false); }
  }

  async function duplicatePersona(p: Persona) {
    try {
      const res = await authFetch("/api/chat/personas", {
        method: "POST",
        body: JSON.stringify({
          name: `${p.name} (copy)`, avatarUrl: p.avatar_url,
          description: p.description, personality: p.personality,
          scenario: p.scenario, greeting: p.greeting, exampleDialogue: p.example_dialogue,
        }),
      });
      if (res.ok) { await fetchPersonas(); toast({ title: "Persona duplicated" }); }
    } catch { toast({ title: "Failed to duplicate", variant: "destructive" }); }
  }

  async function deletePersona(id: number) {
    try {
      await authFetch(`/api/chat/personas/${id}`, { method: "DELETE" });
      setPersonas(prev => prev.filter(p => p.id !== id));
      if (activeConv?.persona_id === id) await updateConvMode(activeConv.mode, null);
      toast({ title: "Persona deleted" });
    } catch { toast({ title: "Failed to delete", variant: "destructive" }); }
  }

  async function importJsonCard() {
    if (!importJson.trim()) return;
    setImportingCard(true);
    try {
      const parsed = JSON.parse(importJson) as Record<string, unknown>;
      const res = await authFetch("/api/chat/personas/import", {
        method: "POST",
        body: JSON.stringify(parsed),
      });
      if (res.ok) {
        await fetchPersonas();
        setShowImportDialog(false);
        setImportJson("");
        toast({ title: "Character card imported" });
      } else {
        const err = await res.json() as { error?: string };
        toast({ title: err.error ?? "Import failed", variant: "destructive" });
      }
    } catch {
      toast({ title: "Invalid JSON", variant: "destructive" });
    } finally { setImportingCard(false); }
  }

  async function importPngCard(file: File) {
    setImportingCard(true);
    try {
      const buf = await file.arrayBuffer();
      const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
      const res = await authFetch("/api/chat/personas/import", {
        method: "POST",
        body: JSON.stringify({ pngBase64: b64 }),
      });
      if (res.ok) {
        await fetchPersonas();
        toast({ title: "Character card imported from PNG" });
      } else {
        const err = await res.json() as { error?: string };
        toast({ title: err.error ?? "Import failed", variant: "destructive" });
      }
    } catch { toast({ title: "Failed to read PNG", variant: "destructive" }); }
    finally { setImportingCard(false); }
  }

  function handleFileImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    if (file.name.endsWith(".png")) {
      importPngCard(file);
    } else {
      const reader = new FileReader();
      reader.onload = (ev) => {
        setImportJson(ev.target?.result as string ?? "");
        setShowImportDialog(true);
      };
      reader.readAsText(file);
    }
  }

  if (!isLoaded) return null;

  if (!isPro) {
    return (
      <div className="p-6 h-full">
        <PremiumGate feature="AI Chat">
          <div className="h-96 rounded-lg bg-muted/20 flex items-center justify-center">
            <MessageSquare className="h-16 w-16 text-muted-foreground/20" />
          </div>
        </PremiumGate>
      </div>
    );
  }

  const activePersona = personas.find(p => p.id === activeConv?.persona_id) ?? null;

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left sidebar */}
      <div className="w-64 flex-shrink-0 border-r border-border flex flex-col bg-card/50">
        <div className="p-3 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-semibold">Chats</h2>
          <div className="flex gap-1">
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setShowPersonaManager(true)} title="Manage personas">
              <UserCircle className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={createConversation} title="New chat">
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <ScrollArea className="flex-1">
          {loadingConvs ? (
            <div className="p-4 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : conversations.length === 0 ? (
            <div className="p-4 text-center text-xs text-muted-foreground">
              <MessageSquare className="h-6 w-6 mx-auto mb-2 opacity-40" />
              No chats yet
            </div>
          ) : (
            <div className="p-2 space-y-0.5">
              {conversations.map(conv => (
                <div
                  key={conv.id}
                  className={`group flex items-center gap-2 rounded-md px-2 py-2 cursor-pointer transition-colors ${
                    conv.id === activeConvId
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                  onClick={() => setActiveConvId(conv.id)}
                >
                  {renamingConvId === conv.id ? (
                    <div className="flex-1 flex gap-1" onClick={e => e.stopPropagation()}>
                      <input
                        className="flex-1 min-w-0 text-xs bg-background border border-border rounded px-1.5 py-0.5 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                        value={renameInput}
                        onChange={e => setRenameInput(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === "Enter") renameConversation(conv.id, renameInput);
                          if (e.key === "Escape") setRenamingConvId(null);
                        }}
                        autoFocus
                      />
                      <button onClick={() => renameConversation(conv.id, renameInput)} className="text-green-400 hover:text-green-300">
                        <Check className="h-3 w-3" />
                      </button>
                      <button onClick={() => setRenamingConvId(null)} className="text-muted-foreground hover:text-foreground">
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ) : (
                    <>
                      <MessageSquare className="h-3.5 w-3.5 flex-shrink-0" />
                      <span className="text-xs flex-1 min-w-0 truncate">{conv.title}</span>
                      <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          className="h-5 w-5 flex items-center justify-center text-muted-foreground hover:text-foreground rounded"
                          onClick={e => { e.stopPropagation(); setRenamingConvId(conv.id); setRenameInput(conv.title); }}
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                        <button
                          className="h-5 w-5 flex items-center justify-center text-muted-foreground hover:text-destructive rounded"
                          onClick={e => { e.stopPropagation(); deleteConversation(conv.id); }}
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {activeConv ? (
          <>
            {/* Mode toggle bar */}
            <div className="border-b border-border px-4 py-2 flex items-center gap-3 bg-card/30 flex-shrink-0 flex-wrap">
              <div className="flex gap-1 bg-muted/50 rounded-lg p-0.5">
                {(["general", "app-help", "roleplay"] as ChatMode[]).map(mode => {
                  const cfg = MODE_CONFIG[mode];
                  const Icon = cfg.icon;
                  const active = activeConv.mode === mode;
                  return (
                    <button
                      key={mode}
                      onClick={() => updateConvMode(mode)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                        active
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {cfg.label}
                    </button>
                  );
                })}
              </div>

              {activeConv.mode === "roleplay" && (
                <div className="flex items-center gap-2">
                  {activePersona ? (
                    <div className="flex items-center gap-2">
                      <PersonaAvatar persona={activePersona} />
                      <span className="text-xs font-medium">{activePersona.name}</span>
                      <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground italic">No persona selected</span>
                  )}
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setShowPersonaManager(true)}>
                    <Settings className="h-3 w-3" />
                    {activePersona ? "Change" : "Select Persona"}
                  </Button>
                </div>
              )}
            </div>

            {/* Messages */}
            <ScrollArea className="flex-1 overflow-y-auto">
              <div className="p-4 space-y-4 max-w-3xl mx-auto">
                {ollamaMissing && (
                  <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 p-4 flex gap-3">
                    <AlertCircle className="h-5 w-5 text-yellow-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-semibold text-yellow-300">Ollama not reachable</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        The chat requires a local Ollama instance. Make sure Ollama is running and configured on the{" "}
                        <a href="/ai" className="text-primary underline underline-offset-2">AI Control page</a>.
                      </p>
                    </div>
                  </div>
                )}

                {activeConv.mode === "roleplay" && !activePersona && messages.length === 0 && (
                  <div className="text-center py-12 text-muted-foreground">
                    <Theater className="h-12 w-12 mx-auto mb-3 opacity-30" />
                    <p className="text-sm font-medium">No persona selected</p>
                    <p className="text-xs mt-1">Select or create a persona to start a roleplay chat.</p>
                    <Button size="sm" className="mt-3 gap-1.5" onClick={() => setShowPersonaManager(true)}>
                      <UserCircle className="h-4 w-4" /> Manage Personas
                    </Button>
                  </div>
                )}

                {!loadingMsgs && messages.length === 0 && activeConv.mode !== "roleplay" && (
                  <div className="text-center py-12 text-muted-foreground">
                    <MessageSquare className="h-12 w-12 mx-auto mb-3 opacity-30" />
                    <p className="text-sm font-medium">{MODE_CONFIG[activeConv.mode].desc}</p>
                    <p className="text-xs mt-1">Type a message to start.</p>
                  </div>
                )}

                {loadingMsgs && (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                )}

                {messages.filter(m => m.role !== "system").map((msg, i) => (
                  <MessageBubble
                    key={msg.id}
                    msg={msg}
                    isLast={i === messages.filter(m => m.role !== "system").length - 1}
                    persona={activePersona}
                    copiedId={copiedMsgId}
                    onCopy={() => copyMessage(msg.id, msg.content)}
                    onDelete={() => deleteMessage(msg.id)}
                    onRegenerate={msg.role === "assistant" ? regenerateLast : undefined}
                  />
                ))}

                {streaming && streamContent && (
                  <div className="flex gap-3">
                    <div className="h-8 w-8 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center flex-shrink-0">
                      {activePersona ? (
                        <span className="text-xs font-bold text-primary">{activePersona.name[0]?.toUpperCase()}</span>
                      ) : (
                        <Bot className="h-4 w-4 text-primary" />
                      )}
                    </div>
                    <div className="flex-1 bg-muted/40 rounded-2xl rounded-tl-sm px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap">
                      {streamContent}
                      <span className="inline-block w-1.5 h-4 bg-primary animate-pulse ml-0.5 rounded-sm" />
                    </div>
                  </div>
                )}

                {streaming && !streamContent && (
                  <div className="flex gap-3">
                    <div className="h-8 w-8 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center flex-shrink-0">
                      <Bot className="h-4 w-4 text-primary" />
                    </div>
                    <div className="flex items-center gap-1.5 bg-muted/40 rounded-2xl rounded-tl-sm px-4 py-3">
                      <span className="h-2 w-2 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:0ms]" />
                      <span className="h-2 w-2 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:150ms]" />
                      <span className="h-2 w-2 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:300ms]" />
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>
            </ScrollArea>

            {/* Composer */}
            <div className="border-t border-border p-4 flex-shrink-0">
              <div className="max-w-3xl mx-auto flex gap-2">
                <div className="flex-1 relative">
                  <Textarea
                    ref={composerRef}
                    value={composer}
                    onChange={e => setComposer(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
                    }}
                    placeholder={
                      activeConv.mode === "roleplay" && !activePersona
                        ? "Select a persona first…"
                        : "Type a message… (Enter to send, Shift+Enter for newline)"
                    }
                    disabled={streaming || (activeConv.mode === "roleplay" && !activePersona)}
                    className="min-h-[72px] max-h-48 resize-none pr-4 text-sm"
                    rows={3}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Button
                    onClick={sendMessage}
                    disabled={!composer.trim() || streaming || (activeConv.mode === "roleplay" && !activePersona)}
                    className="flex-1"
                  >
                    {streaming ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send"}
                  </Button>
                  {streaming && (
                    <Button variant="outline" size="sm" onClick={() => abortRef.current?.abort()}>
                      Stop
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-4">
            <MessageSquare className="h-16 w-16 opacity-20" />
            <div className="text-center">
              <p className="font-medium">No conversation selected</p>
              <p className="text-sm mt-1">Start a new chat or select one from the sidebar.</p>
            </div>
            <Button onClick={createConversation} className="gap-2">
              <Plus className="h-4 w-4" /> New Chat
            </Button>
          </div>
        )}
      </div>

      {/* Persona Manager Modal */}
      <Dialog open={showPersonaManager} onOpenChange={setShowPersonaManager}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserCircle className="h-5 w-5 text-primary" />
              Persona Manager
            </DialogTitle>
            <DialogDescription>Create and manage AI personas for Roleplay mode.</DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-4 py-2">
            {editingPersona !== null || personaForm !== BLANK_PERSONA_FORM && personaForm.name ? (
              <PersonaForm
                form={personaForm}
                onChange={setPersonaForm}
                onSave={savePersona}
                onCancel={() => { setEditingPersona(null); setPersonaForm(BLANK_PERSONA_FORM); }}
                saving={savingPersona}
                isEdit={!!editingPersona}
              />
            ) : (
              <>
                <div className="flex items-center gap-2 flex-wrap">
                  <Button size="sm" className="gap-1.5" onClick={() => { setEditingPersona(null); setPersonaForm(BLANK_PERSONA_FORM); }}>
                    <Plus className="h-3.5 w-3.5" /> New Persona
                  </Button>
                  <input ref={fileInputRef} type="file" accept=".json,.png" className="hidden" onChange={handleFileImport} />
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={() => fileInputRef.current?.click()} disabled={importingCard}>
                    {importingCard ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                    Import Card (.json / .png)
                  </Button>
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setShowImportDialog(true)}>
                    Paste JSON
                  </Button>
                </div>

                {personas.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <UserCircle className="h-10 w-10 mx-auto mb-2 opacity-30" />
                    <p className="text-sm">No personas yet. Create one or import a Character Card.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {personas.map(p => (
                      <div key={p.id} className="flex items-center gap-3 p-3 rounded-lg border border-border bg-card/50 group">
                        <PersonaAvatar persona={p} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{p.name}</p>
                          <p className="text-xs text-muted-foreground truncate">{p.description || p.personality || "No description"}</p>
                          {p.source === "imported" && (
                            <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">Imported</span>
                          )}
                        </div>
                        {activeConv && (
                          <Button
                            size="sm"
                            variant={activeConv.persona_id === p.id ? "default" : "outline"}
                            className="h-7 text-xs"
                            onClick={async () => {
                              await updateConvMode("roleplay", activeConv.persona_id === p.id ? null : p.id);
                            }}
                          >
                            {activeConv.persona_id === p.id ? "Active" : "Use"}
                          </Button>
                        )}
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditingPersona(p); setPersonaForm({ name: p.name, avatarUrl: p.avatar_url ?? "", description: p.description, personality: p.personality, scenario: p.scenario, greeting: p.greeting, exampleDialogue: p.example_dialogue }); }}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => duplicatePersona(p)}>
                            <Copy className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => deletePersona(p.id)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowPersonaManager(false); setEditingPersona(null); setPersonaForm(BLANK_PERSONA_FORM); }}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Paste JSON import dialog */}
      <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Import Character Card (JSON)</DialogTitle>
            <DialogDescription>
              Paste a Character Card v1 or v2 JSON (exported from crushon.ai, Chub.ai, SillyTavern, etc.)
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={importJson}
            onChange={e => setImportJson(e.target.value)}
            placeholder='{ "name": "...", "description": "...", ... }'
            className="font-mono text-xs min-h-[200px] resize-none"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowImportDialog(false); setImportJson(""); }}>Cancel</Button>
            <Button onClick={importJsonCard} disabled={importingCard || !importJson.trim()}>
              {importingCard ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MessageBubble({
  msg, isLast, persona, copiedId, onCopy, onDelete, onRegenerate
}: {
  msg: ChatMessage;
  isLast: boolean;
  persona: Persona | null;
  copiedId: number | null;
  onCopy: () => void;
  onDelete: () => void;
  onRegenerate?: () => void;
}) {
  const isUser = msg.role === "user";

  return (
    <div className={`flex gap-3 group ${isUser ? "flex-row-reverse" : ""}`}>
      <div className={`h-8 w-8 rounded-full flex items-center justify-center flex-shrink-0 border ${
        isUser ? "bg-muted border-border" : "bg-primary/20 border-primary/30"
      }`}>
        {isUser
          ? <User className="h-4 w-4 text-muted-foreground" />
          : persona
            ? <span className="text-xs font-bold text-primary">{persona.name[0]?.toUpperCase()}</span>
            : <Bot className="h-4 w-4 text-primary" />
        }
      </div>
      <div className={`flex-1 min-w-0 ${isUser ? "items-end" : "items-start"} flex flex-col gap-1`}>
        <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
          isUser
            ? "bg-primary text-primary-foreground rounded-tr-sm self-end"
            : "bg-muted/40 text-foreground rounded-tl-sm"
        }`}>
          {msg.content}
        </div>
        <div className={`flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity ${isUser ? "flex-row-reverse" : ""}`}>
          <button onClick={onCopy} className="p-1 text-muted-foreground hover:text-foreground rounded transition-colors" title="Copy">
            {copiedId === msg.id ? <Check className="h-3 w-3 text-green-400" /> : <Copy className="h-3 w-3" />}
          </button>
          {!isUser && isLast && onRegenerate && (
            <button onClick={onRegenerate} className="p-1 text-muted-foreground hover:text-foreground rounded transition-colors" title="Regenerate">
              <RefreshCw className="h-3 w-3" />
            </button>
          )}
          <button onClick={onDelete} className="p-1 text-muted-foreground hover:text-destructive rounded transition-colors" title="Delete">
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  );
}

function PersonaForm({
  form, onChange, onSave, onCancel, saving, isEdit
}: {
  form: typeof BLANK_PERSONA_FORM;
  onChange: (f: typeof BLANK_PERSONA_FORM) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  isEdit: boolean;
}) {
  const f = (k: keyof typeof BLANK_PERSONA_FORM, v: string) => onChange({ ...form, [k]: v });
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">{isEdit ? "Edit Persona" : "New Persona"}</h3>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Name *</Label>
          <Input value={form.name} onChange={e => f("name", e.target.value)} placeholder="Character name" className="h-8 text-sm" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Avatar URL</Label>
          <Input value={form.avatarUrl} onChange={e => f("avatarUrl", e.target.value)} placeholder="https://…" className="h-8 text-sm" />
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Description</Label>
        <Textarea value={form.description} onChange={e => f("description", e.target.value)} placeholder="Physical appearance, background…" className="text-sm min-h-[72px] resize-none" />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Personality</Label>
        <Textarea value={form.personality} onChange={e => f("personality", e.target.value)} placeholder="Personality traits, quirks, speech patterns…" className="text-sm min-h-[60px] resize-none" />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Scenario</Label>
        <Textarea value={form.scenario} onChange={e => f("scenario", e.target.value)} placeholder="Setting and context for the roleplay…" className="text-sm min-h-[60px] resize-none" />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Greeting Message</Label>
        <Textarea value={form.greeting} onChange={e => f("greeting", e.target.value)} placeholder="First message sent when chat starts…" className="text-sm min-h-[60px] resize-none" />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Example Dialogue</Label>
        <Textarea value={form.exampleDialogue} onChange={e => f("exampleDialogue", e.target.value)} placeholder={`<user>: Hello!\n<bot>: Hi there!`} className="text-sm min-h-[72px] resize-none font-mono" />
      </div>
      <div className="flex gap-2 pt-1">
        <Button onClick={onSave} disabled={!form.name.trim() || saving} className="gap-1.5">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          {isEdit ? "Save Changes" : "Create Persona"}
        </Button>
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}
