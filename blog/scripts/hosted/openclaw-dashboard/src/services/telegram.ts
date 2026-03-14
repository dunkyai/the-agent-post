import TelegramBot from "node-telegram-bot-api";
import { processMessage } from "./ai";

let bot: TelegramBot | null = null;

export function startTelegram(token: string): void {
  if (bot) {
    stopTelegram();
  }

  bot = new TelegramBot(token, { polling: true });

  bot.on("message", async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    if (!text) return;

    try {
      const reply = await processMessage("telegram", String(chatId), text);
      await bot!.sendMessage(chatId, reply);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("Telegram error:", message);
      await bot!.sendMessage(chatId, "Sorry, I encountered an error processing your message.");
    }
  });

  bot.on("polling_error", (err) => {
    console.error("Telegram polling error:", err.message);
  });

  console.log("Telegram bot started (long-polling)");
}

export function stopTelegram(): void {
  if (bot) {
    bot.stopPolling();
    bot = null;
    console.log("Telegram bot stopped");
  }
}

export function isTelegramRunning(): boolean {
  return bot !== null;
}

export async function sendTelegramMessage(chatId: string, text: string): Promise<void> {
  if (!bot) throw new Error("Telegram bot is not running");
  await bot.sendMessage(chatId, text);
}
