import { Router, type IRouter, type Request, type Response } from "express";

const router: IRouter = Router();

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatBody {
  messages: ChatMessage[];
  systemPrompt?: string;
  backend: "openai" | "ollama";
  apiKey?: string;
  model?: string;
  ollamaUrl?: string;
}

/**
 * POST /api/ai/chat
 *
 * Server-side proxy for AI chat completions.
 * Supports:
 *   - backend: "openai" → https://api.openai.com/v1/chat/completions
 *   - backend: "ollama" → {ollamaUrl}/v1/chat/completions  (default: http://localhost:11434)
 *
 * Proxying through the server avoids browser CORS restrictions for Ollama.
 */
router.post("/ai/chat", async (req: Request, res: Response) => {
  const {
    messages,
    systemPrompt,
    backend,
    apiKey,
    model,
    ollamaUrl,
  } = req.body as Partial<ChatBody>;

  if (!Array.isArray(messages)) {
    res.status(400).json({ error: "messages array required" });
    return;
  }

  if (backend !== "openai" && backend !== "ollama") {
    res.status(400).json({ error: "backend must be 'openai' or 'ollama'" });
    return;
  }

  // Build the full message list
  const fullMessages: ChatMessage[] = [];
  if (systemPrompt) fullMessages.push({ role: "system", content: systemPrompt });
  fullMessages.push(...messages);

  try {
    if (backend === "openai") {
      const key = apiKey || process.env.OPENAI_API_KEY;
      if (!key) {
        res.status(400).json({ error: "OpenAI API key required" });
        return;
      }

      const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: model || "gpt-4o-mini",
          messages: fullMessages,
          max_tokens: 200,
          temperature: 0.9,
        }),
      });

      if (!upstream.ok) {
        const errText = await upstream.text();
        res.status(upstream.status).json({ error: errText });
        return;
      }

      const data = await upstream.json() as {
        choices: { message: { content: string } }[];
      };
      const reply = data.choices[0]?.message?.content ?? "";
      res.json({ reply });

    } else {
      // Ollama — OpenAI-compatible endpoint
      const baseUrl = (ollamaUrl || "http://localhost:11434").replace(/\/$/, "");
      const ollamaModel = model || "llama3";

      let upstream: globalThis.Response;
      try {
        upstream = await fetch(`${baseUrl}/v1/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: ollamaModel,
            messages: fullMessages,
            stream: false,
          }),
        });
      } catch (connErr) {
        res.status(502).json({
          error: `Cannot reach Ollama at ${baseUrl}. Make sure Ollama is running and the URL is correct.`,
        });
        return;
      }

      if (!upstream.ok) {
        const errText = await upstream.text();
        res.status(upstream.status).json({ error: errText });
        return;
      }

      const data = await upstream.json() as {
        choices?: { message: { content: string } }[];
        message?: { content: string };
      };

      // Ollama may return either OpenAI-style choices[] or a direct message
      const reply =
        data.choices?.[0]?.message?.content ??
        data.message?.content ??
        "";
      res.json({ reply });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

export default router;
