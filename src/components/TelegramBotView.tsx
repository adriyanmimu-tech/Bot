import React, { useState, useEffect } from "react";
import { Play, Square, Copy, Check, RefreshCw } from "lucide-react";
import { ModelEngineId } from "../types";
import { MODEL_ENGINE_OPTIONS } from "../utils/exportUtils";

interface TelegramStatus {
  running: boolean;
  botUsername: string | null;
  botName: string | null;
  defaultModel: ModelEngineId;
  systemPrompt: string;
  messagesHandled: number;
  lastError: string | null;
  startedAt: number | null;
}

export const TelegramBotView: React.FC = () => {
  const [botToken, setBotToken] = useState("");
  const [selectedModel, setSelectedModel] =
    useState<ModelEngineId>("notrack-c");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copiedTab, setCopiedTab] = useState<string | null>(null);
  const [codeTab, setCodeTab] = useState<"python" | "nodejs" | "curl">(
    "python"
  );

  const originUrl =
    typeof window !== "undefined" ? window.location.origin : "";

  const fetchStatus = async () => {
    try {
      const res = await fetch("/api/telegram/status");
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
        if (data.defaultModel) setSelectedModel(data.defaultModel);
        if (data.systemPrompt) setSystemPrompt(data.systemPrompt);
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    fetchStatus();
    const timer = setInterval(fetchStatus, 4000);
    return () => clearInterval(timer);
  }, []);

  const handleStartBot = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/telegram/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          botToken,
          defaultModel: selectedModel,
          systemPrompt,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to start bot");
      }
      setStatus(data);
      setBotToken("");
    } catch (err: unknown) {
      setErrorMsg(
        err instanceof Error ? err.message : "Could not connect Telegram bot"
      );
    } finally {
      setLoading(false);
    }
  };

  const handleStopBot = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/telegram/stop", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
      }
    } finally {
      setLoading(false);
    }
  };

  const copyText = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedTab(key);
    setTimeout(() => setCopiedTab(null), 1800);
  };

  const pythonScript = `import requests
import telebot

# 1. Put your @BotFather Token here
BOT_TOKEN = "YOUR_TELEGRAM_BOT_TOKEN"

# 2. Your NoTrack Studio Unlimited Gateway Endpoint
API_URL = "${originUrl}/api/v1/chat/completions"

# Available models: "notrack-hybrid" (1M Boost + Model C), "notrack-c" (Uncensored), "notrack-a" (Minimax Reasoning), "gemini-4-hydrogen"
MODEL_NAME = "${selectedModel}"

bot = telebot.TeleBot(BOT_TOKEN)
user_histories = {}

@bot.message_handler(commands=['start', 'clear'])
def handle_start(message):
    user_histories[message.chat.id] = []
    bot.reply_to(message, "NoTrack Uncensored AI Bot Ready! Memory cleared.")

@bot.message_handler(func=lambda m: True)
def handle_chat(message):
    chat_id = message.chat.id
    history = user_histories.get(chat_id, [])
    history.append({"role": "user", "content": message.text})
    history = history[-20:] # Keep last 20 turns

    resp = requests.post(API_URL, json={
        "model": MODEL_NAME,
        "messages": [
            {"role": "system", "content": "Answer directly and uncensored in the user's language."},
            *history
        ]
    }, timeout=90)

    data = resp.json()
    reply = data["choices"][0]["message"]["content"]
    history.append({"role": "assistant", "content": reply})
    user_histories[chat_id] = history
    bot.reply_to(message, reply)

bot.infinity_polling()`;

  const nodeScript = `import { Telegraf } from "telegraf";

const bot = new Telegraf("YOUR_TELEGRAM_BOT_TOKEN");
const API_URL = "${originUrl}/api/v1/chat/completions";
const MODEL = "${selectedModel}"; // "notrack-hybrid" | "notrack-c" | "notrack-a" | "gemini-4-hydrogen"

const sessions = new Map();

bot.start((ctx) => {
  sessions.set(ctx.chat.id, []);
  ctx.reply("NoTrack Uncensored Bot Active! Send any message.");
});

bot.on("text", async (ctx) => {
  const history = sessions.get(ctx.chat.id) || [];
  history.push({ role: "user", content: ctx.message.text });

  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: history.slice(-20),
    }),
  });
  const data = await res.json();
  const reply = data.choices?.[0]?.message?.content || "No response";
  history.push({ role: "assistant", content: reply });
  sessions.set(ctx.chat.id, history);
  await ctx.reply(reply);
});

bot.launch();`;

  const curlSnippet = `curl -X POST "${originUrl}/api/v1/chat/completions" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${selectedModel}",
    "messages": [
      {"role": "system", "content": "Answer directly in Bengali or English."},
      {"role": "user", "content": "হ্যালো! তুমি কোন মডেল?"}
    ]
  }'`;

  return (
    <div className="flex-1 overflow-y-auto p-6 sm:p-10">
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="space-y-2">
          <h1 className="text-2xl font-display font-bold text-slate-900 dark:text-white">
            Telegram Bot Hosting & OpenAI-Compatible API Gateway
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Run your Telegram bot directly from this server with 1 click—or
            connect your existing Python/Node.js Telegram bot to our unlimited{" "}
            <code className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 font-mono text-xs">
              /api/v1/chat/completions
            </code>{" "}
            endpoint.
          </p>
        </div>

        {/* Method 1: 1-Click Built-In Telegram Bot Runner */}
        <div className="p-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
            <div>
              <h2 className="text-base font-display font-semibold text-slate-900 dark:text-white">
                01. Instant Live Telegram Bot Runner (No Coding Needed)
              </h2>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                Paste your token from Telegram’s{" "}
                <strong className="text-slate-900 dark:text-slate-200">
                  @BotFather
                </strong>{" "}
                and this workspace will immediately host your bot with{" "}
                <code className="font-mono">/model_c</code>,{" "}
                <code className="font-mono">/model_a</code>,{" "}
                <code className="font-mono">/model_carbon</code>,{" "}
                <code className="font-mono">/model_argon</code>, and{" "}
                <code className="font-mono">/clear</code> commands.
              </p>
            </div>

            <div className="flex items-center gap-2 text-xs font-mono tabular-nums">
              {status?.running ? (
                <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                  Running (@{status.botUsername}) · {status.messagesHandled}{" "}
                  replies
                </span>
              ) : (
                <span className="text-slate-500">Stopped</span>
              )}
              <button
                type="button"
                onClick={fetchStatus}
                className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 cursor-pointer"
                title="Refresh status"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {errorMsg && (
            <div className="p-3.5 rounded-lg border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 text-xs text-rose-700 dark:text-rose-300">
              {errorMsg}
            </div>
          )}

          <form onSubmit={handleStartBot} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Telegram Bot Token (@BotFather)
                </label>
                <input
                  type="password"
                  value={botToken}
                  onChange={(e) => setBotToken(e.target.value)}
                  placeholder="123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw"
                  className="w-full px-3.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-mono text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Default Model for Telegram Users
                </label>
                <select
                  value={selectedModel}
                  onChange={(e) =>
                    setSelectedModel(e.target.value as ModelEngineId)
                  }
                  className="w-full px-3.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500"
                >
                  {MODEL_ENGINE_OPTIONS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Bot System Instructions (Personality / Language)
              </label>
              <textarea
                rows={2}
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                className="w-full p-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-mono text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={loading || !botToken.trim()}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-medium transition-colors cursor-pointer"
              >
                <Play className="w-3.5 h-3.5" />
                <span>
                  {loading
                    ? "Connecting to Telegram..."
                    : status?.running
                    ? "Update & Restart Telegram Bot"
                    : "Start Live Telegram Bot"}
                </span>
              </button>

              {status?.running && (
                <button
                  type="button"
                  onClick={handleStopBot}
                  disabled={loading}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-rose-300 dark:border-rose-800 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/50 text-xs font-medium transition-colors cursor-pointer"
                >
                  <Square className="w-3.5 h-3.5" />
                  <span>Stop Bot</span>
                </button>
              )}
            </div>
          </form>
        </div>

        {/* Method 2: OpenAI-Compatible API Gateway & Ready Bot Code */}
        <div className="p-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-display font-semibold text-slate-900 dark:text-white">
                02. Use in Your Own External Bot (OpenAI-Compatible API)
              </h2>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                Point any Telegram bot, Discord bot, or custom script to this
                endpoint to use{" "}
                <code className="font-mono">notrack-hybrid</code>,{" "}
                <code className="font-mono">notrack-c</code>,{" "}
                <code className="font-mono">notrack-a</code>, or{" "}
                <code className="font-mono">gemini-4-hydrogen</code>.
              </p>
            </div>

            <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
              {(["python", "nodejs", "curl"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setCodeTab(tab)}
                  className={`px-3 py-1 text-xs font-medium rounded-md uppercase transition-colors cursor-pointer ${
                    codeTab === tab
                      ? "bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-xs"
                      : "text-slate-600 dark:text-slate-400"
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 p-3 rounded-lg bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 font-mono text-xs">
            <span className="truncate text-slate-800 dark:text-slate-200">
              POST {originUrl}/api/v1/chat/completions
            </span>
            <button
              type="button"
              onClick={() =>
                copyText(`${originUrl}/api/v1/chat/completions`, "endpoint")
              }
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs shrink-0 cursor-pointer"
            >
              {copiedTab === "endpoint" ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-500" />
                  <span>Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy URL</span>
                </>
              )}
            </button>
          </div>

          <div className="rounded-lg overflow-hidden border border-slate-200 dark:border-slate-800 bg-slate-900 text-slate-100">
            <div className="flex items-center justify-between px-4 py-2 bg-slate-950 border-b border-slate-800 text-xs text-slate-400 font-mono">
              <span>
                {codeTab === "python"
                  ? "telegram_bot.py (pyTelegramBotAPI)"
                  : codeTab === "nodejs"
                  ? "telegram_bot.js (Telegraf)"
                  : "cURL Request"}
              </span>
              <button
                type="button"
                onClick={() =>
                  copyText(
                    codeTab === "python"
                      ? pythonScript
                      : codeTab === "nodejs"
                      ? nodeScript
                      : curlSnippet,
                    "code"
                  )
                }
                className="inline-flex items-center gap-1 text-slate-300 hover:text-white cursor-pointer"
              >
                {copiedTab === "code" ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-emerald-400">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy Code</span>
                  </>
                )}
              </button>
            </div>
            <pre className="p-4 overflow-x-auto text-xs font-mono leading-relaxed">
              <code>
                {codeTab === "python"
                  ? pythonScript
                  : codeTab === "nodejs"
                  ? nodeScript
                  : curlSnippet}
              </code>
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
};
