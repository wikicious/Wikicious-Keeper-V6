import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

const CHAT_FILE = process.env.CHAT_MEMORY_FILE || "./data/chat-sessions.json";
const MAX_MESSAGES = 100;
const sessions = new Map();

function sanitizeMessage(msg) {
  const rawMeta = msg?.meta && typeof msg.meta === "object" ? msg.meta : undefined;
  const meta = rawMeta
    ? {
        decision: rawMeta?.decision && typeof rawMeta.decision === "object" ? rawMeta.decision : undefined,
      }
    : undefined;
  return {
    role: msg?.role === "assistant" ? "assistant" : "user",
    text: String(msg?.text || "").slice(0, 6000),
    at: msg?.at || new Date().toISOString(),
    ...(meta ? { meta } : {}),
  };
}

export function listChatSessions() {
  return Array.from(sessions.values())
    .map((s) => ({
      id: s.id,
      title: s.title,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      messageCount: s.messages.length,
      preview: s.messages[s.messages.length - 1]?.text?.slice(0, 140) || "",
    }))
    .sort((a, b) => Date.parse(b.updatedAt || 0) - Date.parse(a.updatedAt || 0));
}

export function createChatSession(title = "New chat") {
  const now = new Date().toISOString();
  const session = {
    id: randomUUID(),
    title: String(title || "New chat").slice(0, 140),
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
  sessions.set(session.id, session);
  return session;
}

export function getChatSession(id) {
  return sessions.get(String(id || "")) || null;
}

export function appendChatMessage(id, message) {
  const session = getChatSession(id);
  if (!session) return null;
  const sanitized = sanitizeMessage(message);
  session.messages.push(sanitized);
  if ((session.title === "New chat" || !session.title) && sanitized.role === "user" && sanitized.text) {
    session.title = sanitized.text.slice(0, 80);
  }
  if (session.messages.length > MAX_MESSAGES) {
    session.messages.splice(0, session.messages.length - MAX_MESSAGES);
  }
  session.updatedAt = new Date().toISOString();
  return session;
}

export function renameChatSession(id, title) {
  const session = getChatSession(id);
  if (!session) return null;
  session.title = String(title || "New chat").slice(0, 140);
  session.updatedAt = new Date().toISOString();
  return session;
}

export function deleteChatSession(id) {
  return sessions.delete(String(id || ""));
}

export function popLastAssistantMessage(id) {
  const session = getChatSession(id);
  if (!session || session.messages.length === 0) return null;
  const last = session.messages[session.messages.length - 1];
  if (last?.role !== "assistant") return null;
  session.messages.pop();
  session.updatedAt = new Date().toISOString();
  return session;
}

export async function loadChatMemory() {
  try {
    const raw = await readFile(CHAT_FILE, "utf8");
    const parsed = JSON.parse(raw);
    const rows = Array.isArray(parsed?.sessions) ? parsed.sessions : [];
    sessions.clear();
    for (const row of rows) {
      if (!row?.id) continue;
      sessions.set(String(row.id), {
        id: String(row.id),
        title: String(row.title || "New chat").slice(0, 140),
        createdAt: row.createdAt || new Date().toISOString(),
        updatedAt: row.updatedAt || new Date().toISOString(),
        messages: Array.isArray(row.messages) ? row.messages.map(sanitizeMessage).slice(-MAX_MESSAGES) : [],
      });
    }
  } catch {}
}

export async function saveChatMemory() {
  const payload = {
    sessions: Array.from(sessions.values()),
  };
  await mkdir(dirname(CHAT_FILE), { recursive: true });
  await writeFile(CHAT_FILE, JSON.stringify(payload, null, 2), "utf8");
}
