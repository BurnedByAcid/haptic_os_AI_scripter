import { Router, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import { pool } from "../lib/db";

const router = Router();

async function requireSubscriber(req: Request, res: Response): Promise<string | null> {
  const auth = getAuth(req);
  if (!auth.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return null;
  }
  const { rows } = await pool.query(
    `SELECT plan FROM users WHERE clerk_id = $1`,
    [auth.userId]
  );
  const plan = (rows[0] as { plan: string } | undefined)?.plan ?? "free";
  if (plan === "free") {
    res.status(403).json({ error: "Subscriber feature" });
    return null;
  }
  return auth.userId;
}

function buildSystemPrompt(
  mode: string,
  persona?: {
    name: string;
    description: string;
    personality: string;
    scenario: string;
    greeting: string;
    example_dialogue: string;
  } | null
): string {
  if (mode === "general") {
    return "You are a helpful, friendly AI assistant. Be concise and direct.";
  }
  if (mode === "app-help") {
    return `You are a knowledgeable support assistant for HapticOS — a web application for controlling haptic devices like The Handy.
Key features you can help with:
- The Handy device: a connected stroker controlled via the Handy API using a connection key from handyfeeling.com
- Video Player: syncs local videos with .funscript files for haptic feedback
- Manual Control: direct slider control of device position and speed
- Library: manage local funscript files and video pairings
- Scripter: create and edit funscript files with a beat detector, timeline editor, and visual trigger tools
- AI Control: voice and text sessions with personas that control the device in real time
- Chat: this AI chat feature with General, App Help, and Roleplay modes
- Community: share and discover funscripts created by other users
- Funscripts: JSON files with timed position data (time in ms, pos 0-100) that drive haptic devices
- Ollama: local AI models used for private, uncensored chat without cloud providers
Be concise and helpful. Explain things in plain terms.`;
  }
  if (mode === "roleplay" && persona) {
    const parts: string[] = [];
    parts.push(`You are ${persona.name}.`);
    if (persona.description) parts.push(`Description: ${persona.description}`);
    if (persona.personality) parts.push(`Personality: ${persona.personality}`);
    if (persona.scenario) parts.push(`Scenario: ${persona.scenario}`);
    if (persona.example_dialogue) {
      parts.push(`Example dialogue:\n${persona.example_dialogue}`);
    }
    parts.push(`Stay in character as ${persona.name} at all times. Be immersive and engaging.`);
    return parts.join("\n\n");
  }
  return "You are a helpful, friendly AI assistant.";
}

router.get("/chat/personas", async (req: Request, res: Response) => {
  const userId = await requireSubscriber(req, res);
  if (!userId) return;
  try {
    const { rows } = await pool.query(
      `SELECT * FROM chat_personas WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch personas" });
  }
});

router.post("/chat/personas", async (req: Request, res: Response) => {
  const userId = await requireSubscriber(req, res);
  if (!userId) return;
  const { name, avatarUrl, description, personality, scenario, greeting, exampleDialogue, source } =
    req.body as Record<string, string>;
  if (!name?.trim()) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO chat_personas (user_id, name, avatar_url, description, personality, scenario, greeting, example_dialogue, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [
        userId,
        name.trim().slice(0, 128),
        avatarUrl?.trim().slice(0, 512) || null,
        (description ?? "").slice(0, 4000),
        (personality ?? "").slice(0, 4000),
        (scenario ?? "").slice(0, 4000),
        (greeting ?? "").slice(0, 2000),
        (exampleDialogue ?? "").slice(0, 4000),
        source ?? "manual",
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create persona" });
  }
});

router.put("/chat/personas/:id", async (req: Request, res: Response) => {
  const userId = await requireSubscriber(req, res);
  if (!userId) return;
  const { id } = req.params;
  const { name, avatarUrl, description, personality, scenario, greeting, exampleDialogue } =
    req.body as Record<string, string>;
  if (!name?.trim()) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  try {
    const { rows } = await pool.query(
      `UPDATE chat_personas SET name=$1, avatar_url=$2, description=$3, personality=$4, scenario=$5, greeting=$6, example_dialogue=$7, updated_at=NOW()
       WHERE id=$8 AND user_id=$9 RETURNING *`,
      [
        name.trim().slice(0, 128),
        avatarUrl?.trim().slice(0, 512) || null,
        (description ?? "").slice(0, 4000),
        (personality ?? "").slice(0, 4000),
        (scenario ?? "").slice(0, 4000),
        (greeting ?? "").slice(0, 2000),
        (exampleDialogue ?? "").slice(0, 4000),
        id,
        userId,
      ]
    );
    if (!rows.length) { res.status(404).json({ error: "Not found" }); return; }
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update persona" });
  }
});

router.delete("/chat/personas/:id", async (req: Request, res: Response) => {
  const userId = await requireSubscriber(req, res);
  if (!userId) return;
  const { id } = req.params;
  try {
    await pool.query(`DELETE FROM chat_personas WHERE id=$1 AND user_id=$2`, [id, userId]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete persona" });
  }
});

router.post("/chat/personas/import", async (req: Request, res: Response) => {
  const userId = await requireSubscriber(req, res);
  if (!userId) return;
  try {
    const body = req.body as Record<string, unknown>;
    let card: Record<string, unknown> = {};

    if (body.pngBase64 && typeof body.pngBase64 === "string") {
      const pngData = Buffer.from(body.pngBase64, "base64");
      const extracted = extractPngCharaChunk(pngData);
      if (!extracted) {
        res.status(400).json({ error: "No character metadata found in PNG" });
        return;
      }
      card = JSON.parse(extracted) as Record<string, unknown>;
    } else {
      card = body;
    }

    const parsed = parseCharacterCard(card);
    if (!parsed) {
      res.status(400).json({ error: "Invalid Character Card format (v1 or v2 required)" });
      return;
    }

    const { rows } = await pool.query(
      `INSERT INTO chat_personas (user_id, name, avatar_url, description, personality, scenario, greeting, example_dialogue, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'imported') RETURNING *`,
      [
        userId,
        parsed.name.slice(0, 128),
        null,
        parsed.description.slice(0, 4000),
        parsed.personality.slice(0, 4000),
        parsed.scenario.slice(0, 4000),
        parsed.greeting.slice(0, 2000),
        parsed.example_dialogue.slice(0, 4000),
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: "Failed to import character card" });
  }
});

function extractPngCharaChunk(buf: Buffer): string | null {
  let i = 8;
  while (i < buf.length - 12) {
    const len = buf.readUInt32BE(i);
    const type = buf.toString("ascii", i + 4, i + 8);
    if (type === "tEXt") {
      const chunk = buf.slice(i + 8, i + 8 + len);
      const nullIdx = chunk.indexOf(0);
      if (nullIdx >= 0) {
        const keyword = chunk.slice(0, nullIdx).toString("ascii");
        if (keyword === "chara") {
          const value = chunk.slice(nullIdx + 1).toString("ascii");
          return Buffer.from(value, "base64").toString("utf8");
        }
      }
    }
    i += 12 + len;
  }
  return null;
}

function parseCharacterCard(card: Record<string, unknown>): {
  name: string; description: string; personality: string;
  scenario: string; greeting: string; example_dialogue: string;
} | null {
  const spec = (card.spec as string | undefined)?.toLowerCase();
  if (spec === "chara_card_v2") {
    const data = (card.data as Record<string, unknown>) ?? card;
    return {
      name: String(data.name ?? "").trim() || "Unknown",
      description: String(data.description ?? "").trim(),
      personality: String(data.personality ?? "").trim(),
      scenario: String(data.scenario ?? "").trim(),
      greeting: String(data.first_mes ?? "").trim(),
      example_dialogue: String(data.mes_example ?? "").trim(),
    };
  }
  if (card.name) {
    return {
      name: String(card.name ?? "").trim() || "Unknown",
      description: String(card.description ?? "").trim(),
      personality: String(card.personality ?? "").trim(),
      scenario: String(card.scenario ?? "").trim(),
      greeting: String(card.first_mes ?? "").trim(),
      example_dialogue: String(card.mes_example ?? "").trim(),
    };
  }
  return null;
}

router.get("/chat/conversations", async (req: Request, res: Response) => {
  const userId = await requireSubscriber(req, res);
  if (!userId) return;
  try {
    const { rows } = await pool.query(
      `SELECT c.*, p.name as persona_name FROM chat_conversations c
       LEFT JOIN chat_personas p ON p.id = c.persona_id
       WHERE c.user_id = $1 ORDER BY c.updated_at DESC`,
      [userId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch conversations" });
  }
});

router.post("/chat/conversations", async (req: Request, res: Response) => {
  const userId = await requireSubscriber(req, res);
  if (!userId) return;
  const { title, mode, personaId } = req.body as { title?: string; mode?: string; personaId?: number | null };
  try {
    const { rows } = await pool.query(
      `INSERT INTO chat_conversations (user_id, title, mode, persona_id) VALUES ($1,$2,$3,$4) RETURNING *`,
      [userId, (title ?? "New Chat").slice(0, 128), mode ?? "general", personaId ?? null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create conversation" });
  }
});

router.put("/chat/conversations/:id", async (req: Request, res: Response) => {
  const userId = await requireSubscriber(req, res);
  if (!userId) return;
  const { id } = req.params;
  const { title, mode, personaId } = req.body as { title?: string; mode?: string; personaId?: number | null };
  try {
    const fields: string[] = [];
    const vals: unknown[] = [];
    let idx = 1;
    if (title !== undefined) { fields.push(`title=$${idx++}`); vals.push(title.slice(0, 128)); }
    if (mode !== undefined) { fields.push(`mode=$${idx++}`); vals.push(mode); }
    if (personaId !== undefined) { fields.push(`persona_id=$${idx++}`); vals.push(personaId); }
    fields.push(`updated_at=NOW()`);
    if (!fields.length) { res.json({}); return; }
    vals.push(id, userId);
    const { rows } = await pool.query(
      `UPDATE chat_conversations SET ${fields.join(",")} WHERE id=$${idx++} AND user_id=$${idx} RETURNING *`,
      vals
    );
    if (!rows.length) { res.status(404).json({ error: "Not found" }); return; }
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update conversation" });
  }
});

router.delete("/chat/conversations/:id", async (req: Request, res: Response) => {
  const userId = await requireSubscriber(req, res);
  if (!userId) return;
  const { id } = req.params;
  try {
    await pool.query(`DELETE FROM chat_conversations WHERE id=$1 AND user_id=$2`, [id, userId]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete conversation" });
  }
});

router.get("/chat/conversations/:id/messages", async (req: Request, res: Response) => {
  const userId = await requireSubscriber(req, res);
  if (!userId) return;
  const { id } = req.params;
  try {
    const { rows: convRows } = await pool.query(
      `SELECT id FROM chat_conversations WHERE id=$1 AND user_id=$2`,
      [id, userId]
    );
    if (!convRows.length) { res.status(404).json({ error: "Not found" }); return; }
    const { rows } = await pool.query(
      `SELECT * FROM chat_messages WHERE conversation_id=$1 ORDER BY created_at ASC`,
      [id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch messages" });
  }
});

router.post("/chat/send", async (req: Request, res: Response) => {
  const userId = await requireSubscriber(req, res);
  if (!userId) return;

  const { conversationId, message, ollamaUrl: clientOllamaUrl, ollamaModel: clientOllamaModel } =
    req.body as { conversationId: number; message: string; ollamaUrl?: string; ollamaModel?: string };
  if (!conversationId || !message?.trim()) {
    res.status(400).json({ error: "conversationId and message are required" });
    return;
  }

  try {
    const { rows: convRows } = await pool.query(
      `SELECT c.*, p.name as persona_name, p.description as persona_description,
              p.personality as persona_personality, p.scenario as persona_scenario,
              p.greeting as persona_greeting, p.example_dialogue as persona_example_dialogue
       FROM chat_conversations c
       LEFT JOIN chat_personas p ON p.id = c.persona_id
       WHERE c.id=$1 AND c.user_id=$2`,
      [conversationId, userId]
    );
    if (!convRows.length) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }
    const conv = convRows[0] as {
      mode: string;
      persona_name?: string;
      persona_description?: string;
      persona_personality?: string;
      persona_scenario?: string;
      persona_greeting?: string;
      persona_example_dialogue?: string;
    };

    const persona = conv.persona_name
      ? {
          name: conv.persona_name,
          description: conv.persona_description ?? "",
          personality: conv.persona_personality ?? "",
          scenario: conv.persona_scenario ?? "",
          greeting: conv.persona_greeting ?? "",
          example_dialogue: conv.persona_example_dialogue ?? "",
        }
      : null;

    const systemPrompt = buildSystemPrompt(conv.mode, persona);

    const { rows: history } = await pool.query(
      `SELECT role, content FROM chat_messages WHERE conversation_id=$1 ORDER BY created_at ASC`,
      [conversationId]
    );

    await pool.query(
      `INSERT INTO chat_messages (conversation_id, role, content) VALUES ($1,$2,$3)`,
      [conversationId, "user", message.trim()]
    );

    const ollamaUrl = (clientOllamaUrl || process.env.OLLAMA_URL || "http://localhost:11434").replace(/\/$/, "");
    const ollamaModel = clientOllamaModel || process.env.OLLAMA_MODEL || "llama3";

    const messages = [
      { role: "system", content: systemPrompt },
      ...(history as { role: string; content: string }[]).slice(-20),
      { role: "user", content: message.trim() },
    ];

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    let upstreamRes: globalThis.Response;
    try {
      upstreamRes = await fetch(`${ollamaUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: ollamaModel, messages, stream: true }),
      });
    } catch {
      res.write(`data: ${JSON.stringify({ error: `Cannot reach Ollama at ${ollamaUrl}` })}\n\n`);
      res.end();
      return;
    }

    if (!upstreamRes.ok) {
      const errText = await upstreamRes.text();
      res.write(`data: ${JSON.stringify({ error: errText })}\n\n`);
      res.end();
      return;
    }

    const reader = upstreamRes.body?.getReader();
    if (!reader) {
      res.write(`data: ${JSON.stringify({ error: "No response body" })}\n\n`);
      res.end();
      return;
    }

    const decoder = new TextDecoder();
    let fullContent = "";
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === "data: [DONE]") continue;
        const data = trimmed.startsWith("data: ") ? trimmed.slice(6) : trimmed;
        try {
          const parsed = JSON.parse(data) as {
            choices?: { delta?: { content?: string } }[];
          };
          const token = parsed.choices?.[0]?.delta?.content ?? "";
          if (token) {
            fullContent += token;
            res.write(`data: ${JSON.stringify({ token })}\n\n`);
          }
        } catch { /* skip malformed */ }
      }
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();

    if (fullContent) {
      await pool.query(
        `INSERT INTO chat_messages (conversation_id, role, content) VALUES ($1,$2,$3)`,
        [conversationId, "assistant", fullContent]
      );
      await pool.query(
        `UPDATE chat_conversations SET updated_at=NOW() WHERE id=$1`,
        [conversationId]
      );
    }
  } catch (err) {
    console.error("Chat send error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal error" });
    } else {
      try { res.write(`data: ${JSON.stringify({ error: "Stream error" })}\n\n`); res.end(); } catch { /* ignore */ }
    }
  }
});

router.delete("/chat/messages/:id", async (req: Request, res: Response) => {
  const userId = await requireSubscriber(req, res);
  if (!userId) return;
  const { id } = req.params;
  try {
    await pool.query(
      `DELETE FROM chat_messages WHERE id=$1 AND conversation_id IN (SELECT id FROM chat_conversations WHERE user_id=$2)`,
      [id, userId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete message" });
  }
});

export default router;
