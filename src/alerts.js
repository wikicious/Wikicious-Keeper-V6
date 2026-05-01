import { config } from "./config.js";

export async function alert(level, title, body = "") {
  const stamp = new Date().toISOString();
  const tag = level.toUpperCase();
  console.log(`[${stamp}] [${tag}] ${title}${body ? " — " + body : ""}`);
  if (config.discordWebhook) {
    const color = level === "error" ? 0xef4444 : level === "warn" ? 0xf59e0b : 0x10b981;
    try {
      await fetch(config.discordWebhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          embeds: [{ title: `[${tag}] ${title}`, description: body || undefined, color, timestamp: stamp }],
        }),
      });
    } catch (e) {
      console.warn("Discord alert failed:", e.message);
    }
  }
  if (config.telegramBotToken && config.telegramChatId) {
    try {
      const text = `[${tag}] ${title}${body ? `\n${body}` : ""}`;
      await fetch(`https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: config.telegramChatId, text }),
      });
    } catch (e) {
      console.warn("Telegram alert failed:", e.message);
    }
  }
}
