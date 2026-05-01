import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const STORE_DIR = path.resolve(process.cwd(), "data");
const STORE_FILE = path.join(STORE_DIR, "bots.json");

export async function loadBotStore() {
  try {
    const raw = await readFile(STORE_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    return { bots: [] };
  }
}

export async function saveBotStore(payload) {
  await mkdir(STORE_DIR, { recursive: true });
  await writeFile(STORE_FILE, JSON.stringify(payload, null, 2), "utf8");
}

