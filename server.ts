import express from "express";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, ThinkingLevel, GenerateContentResponse } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: "50mb" }));

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

function getAiClient() {
  return new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

interface IncomingAttachment {
  name: string;
  mimeType: string;
  data?: string;
  textContent?: string;
}

interface IncomingMessage {
  role: "user" | "model";
  content: string;
  attachments?: IncomingAttachment[];
}

const NOTRACK_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// Native file/photo upload directly to https://notrack.ai/api/upload
// Automatically rotates UID if free-tier vision_quota (402) is ever reached!
async function uploadAttachmentToNoTrack(
  att: IncomingAttachment,
  currentUid: string
): Promise<{ fileId: string | null; activeUid: string }> {
  let uidToUse = currentUid;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const formData = new FormData();
      let buffer: Buffer;
      let mime = att.mimeType || "application/octet-stream";

      if (att.data) {
        buffer = Buffer.from(att.data, "base64");
      } else if (att.textContent) {
        buffer = Buffer.from(att.textContent, "utf-8");
        mime = "text/plain";
      } else {
        return { fileId: null, activeUid: uidToUse };
      }

      const blob = new Blob([new Uint8Array(buffer)], { type: mime });
      formData.append("file", blob, att.name || "upload.jpg");

      const r = await fetch("https://notrack.ai/api/upload", {
        method: "POST",
        headers: {
          Origin: "https://notrack.ai",
          Referer: "https://notrack.ai/chat",
          Cookie: `uid=${uidToUse}`,
          "User-Agent": NOTRACK_UA,
        },
        body: formData,
      });

      const data = await r.json().catch(() => ({}));

      // If daily photo quota reached on this UID, rotate to a brand-new UID and retry!
      if (r.status === 402 || data.error === "vision_quota") {
        uidToUse = crypto.randomUUID();
        continue;
      }

      if (data && data.file_id) {
        return { fileId: data.file_id, activeUid: uidToUse };
      }
    } catch {
      // retry with fresh uid
      uidToUse = crypto.randomUUID();
    }
  }

  return { fileId: null, activeUid: uidToUse };
}

// Builds a compact native "instructions" carry string ONLY when rolling over to a new UID/chat_id
function buildNativeCarryInstructions(
  priorMessages: IncomingMessage[],
  customInstructions?: string
): string | undefined {
  const parts: string[] = [];
  if (customInstructions && customInstructions.trim()) {
    parts.push(customInstructions.trim());
  }
  if (priorMessages.length > 0) {
    const recent = priorMessages
      .slice(-10)
      .map(
        (m) => `${m.role === "user" ? "User" : "You"}: ${m.content.slice(0, 400)}`
      )
      .join("\n");
    parts.push(`Previous conversation context:\n${recent}`);
  }
  if (parts.length === 0) return undefined;
  return parts.join("\n\n").slice(0, 3800);
}

// 100% Pure Native NoTrack Dispatch Streamer
// Sends the user's EXACT raw user_input without any English meta-wrappers,
// maintains native (uid, chat_id) session continuity on notrack.ai,
// and seamlessly rotates UID + carries memory when ctx_cut / vision_quota / ratelimit occurs!
async function streamPureNoTrackNative(options: {
  messages: IncomingMessage[];
  notrackModelCode: "C" | "A";
  personaStyle: string;
  customInstructions?: string;
  existingUid?: string;
  existingChatId?: string | null;
  forceNewChatRollover?: boolean;
  onChunk: (text: string) => void;
  onMeta?: (meta: {
    uid: string;
    chatId: string | null;
    ctxCut: boolean;
  }) => void;
}): Promise<string> {
  const {
    messages,
    notrackModelCode,
    personaStyle,
    customInstructions,
    existingUid,
    existingChatId,
    forceNewChatRollover,
    onChunk,
    onMeta,
  } = options;

  const validPersona = ["normal", "concise", "detailed", "creative"].includes(
    personaStyle
  )
    ? personaStyle
    : "normal";

  const latestMsg = messages[messages.length - 1];
  const priorMsgs = messages.slice(0, -1);

  let activeUid = existingUid || crypto.randomUUID();
  let activeChatId: string | null = forceNewChatRollover
    ? null
    : existingChatId || null;

  let lastError: Error | null = null;
  let fullCollected = "";

  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 1200 * attempt));
      // Rotate UID on retry to bypass burst rate limit or session mismatch
      activeUid = crypto.randomUUID();
      activeChatId = null;
    }

    // Upload any attachments on the latest message natively to notrack.ai/api/upload
    // (Done inside the attempt loop so file_ids always belong to the current activeUid)
    const uploadedFileIds: string[] = [];
    if (latestMsg.attachments && latestMsg.attachments.length > 0) {
      for (const att of latestMsg.attachments) {
        const { fileId, activeUid: nextUid } = await uploadAttachmentToNoTrack(
          att,
          activeUid
        );
        if (nextUid !== activeUid) {
          // UID rotated to bypass vision_quota -> start fresh chat_id with carried history
          activeUid = nextUid;
          activeChatId = null;
        }
        if (fileId) {
          uploadedFileIds.push(fileId);
        }
      }
    }

    // Only pass `instructions` when starting a new chat_id (`!activeChatId`)
    // just like the original notrack.ai/chat client (`(!currentChatId && chatInstr) ? chatInstr : undefined`)
    const instructionsPayload = !activeChatId
      ? buildNativeCarryInstructions(priorMsgs, customInstructions)
      : undefined;

    // Pure raw user_input — ZERO English wrappers!
    // Note: notrack.ai/api/dispatch returns HTTP 400 if user_input.trim() is empty (e.g. photo sent without caption).
    const trimmedInput = latestMsg.content.trim();
    const rawUserInput =
      trimmedInput.length > 0
        ? trimmedInput
        : uploadedFileIds.length > 0
        ? "এই ছবিতে কী দেখা যাচ্ছে? বিস্তারিত বলো।"
        : "হ্যালো";

    const dispatchBody: Record<string, unknown> = {
      user_input: rawUserInput,
      mode: "usual",
      model: notrackModelCode,
      persona: validPersona,
      max_turns: 1,
      chat_id: activeChatId,
      attachments: uploadedFileIds,
      regenerate: false,
      edit: false,
      edit_mid: null,
      via: "typed",
    };

    if (instructionsPayload) {
      dispatchBody.instructions = instructionsPayload;
    }

    const response = await fetch("https://notrack.ai/api/dispatch", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://notrack.ai",
        Referer: "https://notrack.ai/chat",
        Cookie: `uid=${activeUid}`,
        "User-Agent": NOTRACK_UA,
      },
      body: JSON.stringify(dispatchBody),
    });

    if (!response.ok || !response.body) {
      const errBody = await response.text().catch(() => "");
      lastError = new Error(
        `NoTrack HTTP ${response.status}${errBody ? `: ${errBody.slice(0, 120)}` : ""}`
      );
      continue;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let receivedAnyDelta = false;
    let shouldRetry = false;
    let sawCtxCut = false;
    fullCollected = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const dataLine = block
          .split("\n")
          .find((l) => l.startsWith("data: "));
        if (!dataLine) continue;

        try {
          const evt = JSON.parse(dataLine.slice(6));
          if (evt.type === "chat_meta" && evt.chat_id) {
            activeChatId = evt.chat_id;
          } else if (evt.type === "ctx_cut") {
            // Free tier 5,000-token cutoff reached -> flag session so next turn auto-carries into a fresh UID!
            sawCtxCut = true;
          } else if (evt.type === "instr_refused") {
            // If instructions were refused, retry immediately without instructions
            shouldRetry = true;
            break;
          } else if (evt.type === "delta" && evt.chunk) {
            receivedAnyDelta = true;
            fullCollected += evt.chunk;
            onChunk(evt.chunk);
          } else if (
            evt.type === "message" &&
            evt.content &&
            !receivedAnyDelta
          ) {
            receivedAnyDelta = true;
            fullCollected += evt.content;
            onChunk(evt.content);
          } else if (evt.type === "error") {
            if (evt.code === "ratelimit" && attempt < 2) {
              shouldRetry = true;
              break;
            }
            throw new Error(evt.content || "NoTrack stream error");
          }
        } catch (parseErr) {
          if (
            parseErr instanceof Error &&
            !parseErr.message.includes("JSON")
          ) {
            throw parseErr;
          }
        }
      }

      if (shouldRetry) break;
    }

    if (shouldRetry) {
      lastError = new Error("Retrying with fresh NoTrack session...");
      continue;
    }

    if (onMeta) {
      onMeta({
        uid: activeUid,
        chatId: activeChatId,
        ctxCut: sawCtxCut,
      });
    }

    return fullCollected;
  }

  if (lastError) {
    throw lastError;
  }
  return fullCollected;
}

// Complete reply helper for Telegram Bot & OpenAI-compatible API
async function generateCompleteReply(
  messages: IncomingMessage[],
  modelEngine:
    | "notrack-c"
    | "notrack-a"
    | "gemini-4-carbon"
    | "gemini-4-argon"
    | "gemini-4-hydrogen" = "notrack-c",
  notrackStyle = "normal",
  customInstructions?: string,
  sessionState?: { uid?: string; chatId?: string | null }
): Promise<{
  text: string;
  uid?: string;
  chatId?: string | null;
}> {
  if (modelEngine === "notrack-c" || modelEngine === "notrack-a") {
    const code = modelEngine === "notrack-a" ? "A" : "C";
    let nextUid = sessionState?.uid;
    let nextChatId = sessionState?.chatId;

    const text = await streamPureNoTrackNative({
      messages,
      notrackModelCode: code,
      personaStyle: notrackStyle,
      customInstructions,
      existingUid: nextUid,
      existingChatId: nextChatId,
      onChunk: () => {},
      onMeta: (m) => {
        nextUid = m.uid;
        nextChatId = m.ctxCut ? null : m.chatId;
      },
    });

    return { text, uid: nextUid, chatId: nextChatId };
  }

  // Carbon 4 Original, Argon 4 Original, or Gemini 4 Hydrogen
  // Includes automatic Free-Tier 429 quota cascade so Telegram & Web NEVER fail with a 429 error!
  const candidateModels =
    modelEngine === "gemini-4-carbon"
      ? ["gemini-4-carbon", "gemini-4-argon", "gemini-4-hydrogen"]
      : modelEngine === "gemini-4-argon"
      ? ["gemini-4-argon", "gemini-4-hydrogen"]
      : ["gemini-4-hydrogen"];

  const ai = getAiClient();
  const formattedContents = messages.map((m) => {
    const parts: Array<
      | { text: string }
      | { inlineData: { mimeType: string; data: string } }
    > = [];
    if (m.attachments) {
      for (const att of m.attachments) {
        if (att.textContent) {
          parts.push({ text: `[File: ${att.name}]\n${att.textContent}` });
        } else if (att.data && att.mimeType) {
          parts.push({ inlineData: { mimeType: att.mimeType, data: att.data } });
        }
      }
    }
    parts.push({
      text:
        m.content && m.content.trim().length > 0
          ? m.content
          : "এই ছবিতে কী দেখা যাচ্ছে? বিস্তারিত বলো।",
    });
    return { role: m.role, parts };
  });

  for (const candidate of candidateModels) {
    try {
      const res = await ai.models.generateContent({
        model: candidate,
        contents: formattedContents,
        config: {
          systemInstruction: customInstructions || undefined,
          thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
        },
      });
      if (res.text) {
        return { text: res.text };
      }
    } catch {
      // Free-tier quota (429 limit: 0) or scope restriction -> try next candidate
    }
  }

  // Ultimate Unlimited Fallback: If Free Tier Gemini API quota is exhausted (429),
  // seamlessly route through NoTrack Deep Reasoning (Model A) so the user NEVER gets an error!
  let nextUid = sessionState?.uid;
  let nextChatId = sessionState?.chatId;
  const fallbackText = await streamPureNoTrackNative({
    messages,
    notrackModelCode: "A",
    personaStyle: notrackStyle,
    customInstructions,
    existingUid: nextUid,
    existingChatId: nextChatId,
    onChunk: () => {},
    onMeta: (m) => {
      nextUid = m.uid;
      nextChatId = m.ctxCut ? null : m.chatId;
    },
  });

  return { text: fallbackText, uid: nextUid, chatId: nextChatId };
}

// OpenAI-Compatible Endpoint (/api/v1/chat/completions)
app.post("/api/v1/chat/completions", async (req, res) => {
  try {
    const {
      model = "notrack-c",
      messages = [],
      style = "normal",
    } = req.body;

    if (!Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: { message: "messages array is required" } });
      return;
    }

    const sysMsg = messages.find(
      (m: { role: string }) => m.role === "system"
    );
    const chatMsgs: IncomingMessage[] = messages
      .filter((m: { role: string }) => m.role !== "system")
      .map((m: { role: string; content: string }) => ({
        role: m.role === "assistant" ? "model" : "user",
        content:
          typeof m.content === "string"
            ? m.content
            : JSON.stringify(m.content),
      }));

    const engineMap: Record<
      string,
      | "notrack-c"
      | "notrack-a"
      | "gemini-4-carbon"
      | "gemini-4-argon"
      | "gemini-4-hydrogen"
    > = {
      "notrack-uncensored": "notrack-c",
      "notrack-c": "notrack-c",
      "notrack-hybrid": "notrack-c",
      "notrack-a": "notrack-a",
      "notrack-minimax": "notrack-a",
      "gemini-4-carbon": "gemini-4-carbon",
      "carbon-4": "gemini-4-carbon",
      "gemini-4-argon": "gemini-4-argon",
      "argon-4": "gemini-4-argon",
      "gemini-4-hydrogen": "gemini-4-hydrogen",
    };

    const chosenEngine = engineMap[model] || "notrack-c";
    const { text: replyText } = await generateCompleteReply(
      chatMsgs,
      chosenEngine,
      style,
      sysMsg?.content
    );

    res.json({
      id: `chatcmpl-${crypto.randomUUID()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: chosenEngine,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: replyText,
          },
          finish_reason: "stop",
        },
      ],
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Completion error";
    res.status(500).json({ error: { message: msg } });
  }
});

// ============================================================================
// Built-In Live Telegram Bot Runner (100% Pure Native NoTrack Session Per User)
// ============================================================================
interface TelegramBotState {
  running: boolean;
  botUsername: string | null;
  botName: string | null;
  defaultModel:
    | "notrack-c"
    | "notrack-a"
    | "gemini-4-carbon"
    | "gemini-4-argon"
    | "gemini-4-hydrogen";
  systemPrompt: string;
  messagesHandled: number;
  lastError: string | null;
  startedAt: number | null;
}

let tgToken: string | null = null;
let tgPollingActive = false;
let tgOffset = 0;
const tgChatHistory = new Map<number, IncomingMessage[]>();
const tgNativeSession = new Map<
  number,
  { uid: string; chatId: string | null }
>();
const tgChatRoleInstruction = new Map<number, string>();
const tgChatModelOverride = new Map<
  number,
  | "notrack-c"
  | "notrack-a"
  | "gemini-4-carbon"
  | "gemini-4-argon"
  | "gemini-4-hydrogen"
>();

const tgState: TelegramBotState = {
  running: false,
  botUsername: null,
  botName: null,
  defaultModel: "notrack-c",
  systemPrompt: "",
  messagesHandled: 0,
  lastError: null,
  startedAt: null,
};

async function sendTelegramMessage(
  token: string,
  chatId: number,
  text: string
) {
  const formattedText = text.replace(
    /<think>([\s\S]*?)<\/think>/g,
    "💭 Reasoning:\n$1\n\n---\n"
  );
  const chunks: string[] = [];
  for (let i = 0; i < formattedText.length; i += 3900) {
    chunks.push(formattedText.slice(i, i + 3900));
  }
  if (chunks.length === 0) chunks.push("...");

  for (const chunk of chunks) {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: chunk,
      }),
    });
  }
}

async function downloadTelegramPhotoAsBase64(
  token: string,
  fileId: string
): Promise<{ data: string; mimeType: string } | null> {
  try {
    const fileRes = await fetch(
      `https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`
    );
    const fileData = await fileRes.json();
    const filePath = fileData?.result?.file_path;
    if (!filePath) return null;

    const imgRes = await fetch(
      `https://api.telegram.org/file/bot${token}/${filePath}`
    );
    const arrayBuffer = await imgRes.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    const ext = filePath.split(".").pop()?.toLowerCase() || "jpg";
    const mimeType =
      ext === "png"
        ? "image/png"
        : ext === "webp"
        ? "image/webp"
        : "image/jpeg";
    return { data: base64, mimeType };
  } catch {
    return null;
  }
}

async function downloadTelegramDocument(
  token: string,
  fileId: string,
  fileName: string,
  mimeType: string
): Promise<IncomingAttachment | null> {
  try {
    const fileRes = await fetch(
      `https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`
    );
    const fileData = await fileRes.json();
    const filePath = fileData?.result?.file_path;
    if (!filePath) return null;

    const rawRes = await fetch(
      `https://api.telegram.org/file/bot${token}/${filePath}`
    );
    if (!rawRes.ok) return null;

    if (mimeType.startsWith("image/")) {
      const ab = await rawRes.arrayBuffer();
      return {
        name: fileName,
        mimeType,
        data: Buffer.from(ab).toString("base64"),
      };
    }

    const textContent = await rawRes.text();
    return {
      name: fileName,
      mimeType: mimeType || "text/plain",
      textContent: textContent.slice(0, 120000),
    };
  } catch {
    return null;
  }
}

async function fetchGithubSummaryAttachment(
  rawUrlOrRepo: string
): Promise<IncomingAttachment | null> {
  try {
    const cleaned = rawUrlOrRepo
      .trim()
      .replace(/^https?:\/\/github\.com\//i, "")
      .replace(/\.git$/i, "")
      .replace(/\/+$/, "");

    // Single file blob URL
    const blobMatch = cleaned.match(
      /^([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/
    );
    if (blobMatch) {
      const [, owner, repo, branch, filePath] = blobMatch;
      const r = await fetch(
        `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`
      );
      if (r.ok) {
        const text = await r.text();
        return {
          name: `${repo}/${filePath}`,
          mimeType: "text/plain",
          textContent: text.slice(0, 100000),
        };
      }
    }

    const parts = cleaned.split("/");
    if (parts.length < 2) return null;
    const owner = parts[0];
    const repo = parts[1];

    const headers = {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "notrack-pro-telegram-bot",
    };

    const repoRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}`,
      { headers }
    );
    if (!repoRes.ok) return null;
    const repoMeta = await repoRes.json();
    const branch = repoMeta.default_branch || "main";

    const treeRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,
      { headers }
    );
    const treeData = await treeRes.json().catch(() => ({}));
    const fileList: string[] = Array.isArray(treeData.tree)
      ? treeData.tree
          .filter((t: { type: string }) => t.type === "blob")
          .map((t: { path: string }) => t.path)
          .slice(0, 80)
      : [];

    let readmeText = "";
    for (const readmeCandidate of ["README.md", "readme.md", "package.json"]) {
      if (fileList.includes(readmeCandidate)) {
        const rr = await fetch(
          `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${readmeCandidate}`
        );
        if (rr.ok) {
          const t = await rr.text();
          readmeText += `\n\n--- ${readmeCandidate} ---\n${t.slice(0, 15000)}`;
        }
      }
    }

    const summary = `GitHub Repository: ${owner}/${repo} (branch: ${branch})\nDescription: ${
      repoMeta.description || "N/A"
    }\nFiles (${fileList.length}):\n${fileList.join("\n")}${readmeText}`;

    return {
      name: `${owner}_${repo}_github.txt`,
      mimeType: "text/plain",
      textContent: summary,
    };
  } catch {
    return null;
  }
}

async function runTelegramPollingLoop(sessionToken: string) {
  while (tgPollingActive && tgToken === sessionToken) {
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${sessionToken}/getUpdates?offset=${tgOffset}&timeout=20`
      );
      if (!res.ok) {
        tgState.lastError = `Telegram HTTP ${res.status}`;
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }

      const data = await res.json();
      if (!data.ok || !Array.isArray(data.result)) {
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }

      for (const update of data.result) {
        tgOffset = update.update_id + 1;
        const msg = update.message;
        if (!msg || !msg.chat) continue;

        const chatId: number = msg.chat.id;
        let text: string = (msg.text || msg.caption || "").trim();
        const hasPhoto = Array.isArray(msg.photo) && msg.photo.length > 0;
        const hasDocument = Boolean(msg.document && msg.document.file_id);

        if (!text && !hasPhoto && !hasDocument) continue;

        if (text === "/start") {
          const activeMod =
            tgChatModelOverride.get(chatId) || tgState.defaultModel;
          await sendTelegramMessage(
            sessionToken,
            chatId,
            `স্বাগতম! notrack.ai Uncensored Pro Bot চালু আছে।\n\nবর্তমান মডেল: ${activeMod}\n\nকমান্ডসমূহ:\n• যেকোনো কথা, গল্প, রোলপ্লে, ছবি বা কোড ফাইল সরাসরি পাঠান!\n• /github <owner/repo বা GitHub লিংক> — GitHub প্রজেক্ট বা কোড বিশ্লেষণ করুন\n• /role <আপনার নির্দেশনা> — নতুন ক্যারেক্টার বা স্টোরি সেট করুন\n• /model_c — NoTrack Uncensored (Model C)\n• /model_a — NoTrack Reasoning (Model A)\n• /model_carbon — Carbon 4 Original (Deep Reasoning)\n• /model_argon — Argon 4 Original (Pro)\n• /model_gemini — Gemini 4 (1M)\n• /clear — নতুন চ্যাট শুরু করুন`
          );
          continue;
        }

        if (text === "/clear") {
          tgChatHistory.delete(chatId);
          tgNativeSession.delete(chatId);
          await sendTelegramMessage(
            sessionToken,
            chatId,
            "নতুন চ্যাট সেশন শুরু হয়েছে!"
          );
          continue;
        }

        if (text.startsWith("/role ")) {
          const customRole = text.slice(6).trim();
          tgChatRoleInstruction.set(chatId, customRole);
          tgNativeSession.delete(chatId);
          await sendTelegramMessage(
            sessionToken,
            chatId,
            `নতুন Role / Story সেট করা হয়েছে:\n"${customRole}"`
          );
          continue;
        }

        if (text === "/model_c" || text === "/model_boost") {
          tgChatModelOverride.set(chatId, "notrack-c");
          await sendTelegramMessage(
            sessionToken,
            chatId,
            "মডেল: NoTrack Uncensored (Model C) চালু করা হয়েছে।"
          );
          continue;
        }
        if (text === "/model_a") {
          tgChatModelOverride.set(chatId, "notrack-a");
          await sendTelegramMessage(
            sessionToken,
            chatId,
            "মডেল: NoTrack Reasoning (Model A) চালু করা হয়েছে।"
          );
          continue;
        }
        if (text === "/model_carbon") {
          tgChatModelOverride.set(chatId, "gemini-4-carbon");
          await sendTelegramMessage(
            sessionToken,
            chatId,
            "মডেল: Carbon 4 Original (Deep Reasoning) চালু করা হয়েছে।"
          );
          continue;
        }
        if (text === "/model_argon") {
          tgChatModelOverride.set(chatId, "gemini-4-argon");
          await sendTelegramMessage(
            sessionToken,
            chatId,
            "মডেল: Argon 4 Original (Pro) চালু করা হয়েছে।"
          );
          continue;
        }
        if (text === "/model_gemini") {
          tgChatModelOverride.set(chatId, "gemini-4-hydrogen");
          await sendTelegramMessage(
            sessionToken,
            chatId,
            "মডেল: Gemini 4 (1M Native) চালু করা হয়েছে।"
          );
          continue;
        }

        fetch(`https://api.telegram.org/bot${sessionToken}/sendChatAction`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, action: "typing" }),
        }).catch(() => {});

        const attachments: IncomingAttachment[] = [];
        if (hasPhoto) {
          const largestPhoto = msg.photo[msg.photo.length - 1];
          const downloaded = await downloadTelegramPhotoAsBase64(
            sessionToken,
            largestPhoto.file_id
          );
          if (downloaded) {
            attachments.push({
              name: "telegram_photo.jpg",
              mimeType: downloaded.mimeType,
              data: downloaded.data,
            });
          }
        }

        if (hasDocument && msg.document) {
          const docAtt = await downloadTelegramDocument(
            sessionToken,
            msg.document.file_id,
            msg.document.file_name || "document.txt",
            msg.document.mime_type || "text/plain"
          );
          if (docAtt) {
            attachments.push(docAtt);
          }
        }

        // Handle /github command or inline github.com URL in Telegram message
        if (text.startsWith("/github ")) {
          const rest = text.slice(8).trim();
          const [repoPart, ...questionParts] = rest.split(/\s+/);
          if (repoPart) {
            const ghAtt = await fetchGithubSummaryAttachment(repoPart);
            if (ghAtt) {
              attachments.push(ghAtt);
              text =
                questionParts.join(" ").trim() ||
                `এই GitHub প্রজেক্ট/ফাইলটি (${ghAtt.name}) বিশ্লেষণ করে বিস্তারিত বাংলায় বোঝাও।`;
            }
          }
        } else {
          const ghUrlMatch = text.match(
            /https?:\/\/github\.com\/[^\s]+/i
          );
          if (ghUrlMatch) {
            const ghAtt = await fetchGithubSummaryAttachment(ghUrlMatch[0]);
            if (ghAtt) {
              attachments.push(ghAtt);
            }
          }
        }

        const history = tgChatHistory.get(chatId) || [];
        history.push({
          role: "user",
          content: text || " ",
          attachments: attachments.length > 0 ? attachments : undefined,
        });
        if (history.length > 30) {
          history.splice(0, history.length - 30);
        }

        const modelToUse =
          tgChatModelOverride.get(chatId) || tgState.defaultModel;
        const activeRolePrompt =
          tgChatRoleInstruction.get(chatId) || tgState.systemPrompt || undefined;
        const currentNatSession = tgNativeSession.get(chatId);

        try {
          const {
            text: reply,
            uid,
            chatId: nextNatChatId,
          } = await generateCompleteReply(
            history,
            modelToUse,
            "normal",
            activeRolePrompt,
            currentNatSession
          );
          if (uid) {
            tgNativeSession.set(chatId, {
              uid,
              chatId: nextNatChatId ?? null,
            });
          }
          history.push({ role: "model", content: reply });
          tgChatHistory.set(chatId, history);
          tgState.messagesHandled += 1;
          await sendTelegramMessage(sessionToken, chatId, reply);
        } catch (err: unknown) {
          const errMsg =
            err instanceof Error ? err.message : "Failed to generate reply.";
          await sendTelegramMessage(
            sessionToken,
            chatId,
            `ত্রুটি: ${errMsg}`
          );
        }
      }
    } catch (loopErr: unknown) {
      tgState.lastError =
        loopErr instanceof Error ? loopErr.message : "Polling network error";
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

app.get("/api/telegram/status", (_req, res) => {
  res.json(tgState);
});

const TG_CONFIG_FILE = "/tmp/notrack_tg_bot.json";

app.post("/api/telegram/start", async (req, res) => {
  try {
    const {
      botToken,
      defaultModel = "notrack-c",
      systemPrompt = "",
    }: {
      botToken: string;
      defaultModel?:
        | "notrack-c"
        | "notrack-a"
        | "gemini-4-carbon"
        | "gemini-4-argon"
        | "gemini-4-hydrogen";
      systemPrompt?: string;
    } = req.body;

    if (!botToken || !botToken.includes(":")) {
      res
        .status(400)
        .json({ error: "সঠিক Telegram Bot Token দিন (যেমন: 123456:ABC-DEF...)" });
      return;
    }

    const cleanToken = botToken.trim();

    const meRes = await fetch(
      `https://api.telegram.org/bot${cleanToken}/getMe`
    );
    const meData = await meRes.json();
    if (!meRes.ok || !meData.ok || !meData.result) {
      res.status(400).json({
        error:
          meData.description || "Telegram Bot Token ভেরিফাই করা যায়নি।",
      });
      return;
    }

    await fetch(`https://api.telegram.org/bot${cleanToken}/deleteWebhook`);

    tgPollingActive = false;
    await new Promise((r) => setTimeout(r, 300));

    tgToken = cleanToken;
    tgPollingActive = true;
    tgState.running = true;
    tgState.botUsername = meData.result.username || null;
    tgState.botName = meData.result.first_name || "Telegram Bot";
    tgState.defaultModel =
      defaultModel === ("notrack-hybrid" as unknown)
        ? "notrack-c"
        : defaultModel;
    tgState.systemPrompt = systemPrompt.trim();
    tgState.lastError = null;
    tgState.startedAt = Date.now();

    try {
      fs.writeFileSync(
        TG_CONFIG_FILE,
        JSON.stringify({
          botToken: cleanToken,
          defaultModel: tgState.defaultModel,
          systemPrompt: tgState.systemPrompt,
          botUsername: tgState.botUsername,
          botName: tgState.botName,
        }),
        "utf-8"
      );
    } catch {
      // ignore
    }

    runTelegramPollingLoop(cleanToken);

    res.json(tgState);
  } catch (err: unknown) {
    const msg =
      err instanceof Error ? err.message : "Failed to start Telegram bot";
    res.status(500).json({ error: msg });
  }
});

app.post("/api/telegram/stop", (_req, res) => {
  tgPollingActive = false;
  tgToken = null;
  tgState.running = false;
  try {
    if (fs.existsSync(TG_CONFIG_FILE)) {
      fs.unlinkSync(TG_CONFIG_FILE);
    }
  } catch {
    // ignore
  }
  res.json(tgState);
});

// ============================================================================
// Web UI Streaming Endpoint — 100% Pure Native notrack.ai/chat Behavior
// ============================================================================
app.post("/api/chat/stream", async (req, res) => {
  try {
    const {
      messages,
      modelEngine = "notrack-c",
      notrackStyle = "normal",
      notrackUid,
      notrackChatId,
      forceNewChatRollover = false,
      systemInstruction,
      reasoningDepth = "HIGH",
      useWebSearch = false,
    }: {
      messages: IncomingMessage[];
      modelEngine?:
        | "notrack-c"
        | "notrack-a"
        | "gemini-4-carbon"
        | "gemini-4-argon"
        | "gemini-4-hydrogen";
      notrackStyle?: string;
      notrackUid?: string;
      notrackChatId?: string | null;
      forceNewChatRollover?: boolean;
      systemInstruction?: string;
      reasoningDepth?: "LOW" | "HIGH" | "XHIGH";
      useWebSearch?: boolean;
    } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: "Messages array is required." });
      return;
    }

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");

    // Default & Primary: 100% Pure Native NoTrack Uncensored (Model C) or Reasoning (Model A)
    if (
      modelEngine === "notrack-c" ||
      modelEngine === "notrack-a" ||
      (modelEngine as string) === "notrack-hybrid"
    ) {
      const notrackCode = modelEngine === "notrack-a" ? "A" : "C";

      await streamPureNoTrackNative({
        messages,
        notrackModelCode: notrackCode,
        personaStyle: notrackStyle,
        customInstructions: systemInstruction,
        existingUid: notrackUid,
        existingChatId: notrackChatId,
        forceNewChatRollover,
        onChunk: (chunkText) => {
          res.write(`data: ${JSON.stringify({ text: chunkText })}\n\n`);
        },
        onMeta: (meta) => {
          res.write(`data: ${JSON.stringify({ meta })}\n\n`);
        },
      });

      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
      return;
    }

    // Optional: Carbon 4 Original, Argon 4 Original, or Gemini 4 Hydrogen (1,000,000+ Token Context Window)
    const ai = getAiClient();

    const formattedContents = messages.map((msg) => {
      const parts: Array<
        | { text: string }
        | { inlineData: { mimeType: string; data: string } }
      > = [];

      if (msg.attachments && Array.isArray(msg.attachments)) {
        for (const att of msg.attachments) {
          if (att.textContent) {
            parts.push({
              text: `[Attached File: ${att.name}]\n\`\`\`\n${att.textContent}\n\`\`\`\n`,
            });
          } else if (att.data && att.mimeType) {
            parts.push({
              inlineData: {
                mimeType: att.mimeType,
                data: att.data,
              },
            });
          }
        }
      }

      if (msg.content && msg.content.trim().length > 0) {
        parts.push({ text: msg.content });
      } else if (parts.length === 0) {
        parts.push({ text: "Analyze the attached content." });
      }

      return {
        role: msg.role,
        parts,
      };
    });

    const thinkingMap: Record<string, ThinkingLevel> = {
      LOW: ThinkingLevel.LOW,
      HIGH: ThinkingLevel.HIGH,
      XHIGH: ThinkingLevel.XHIGH,
    };

    const selectedThinking = thinkingMap[reasoningDepth] || ThinkingLevel.HIGH;

    const config: Record<string, unknown> = {
      thinkingConfig: {
        thinkingLevel: selectedThinking,
      },
    };

    if (systemInstruction && systemInstruction.trim()) {
      config.systemInstruction = systemInstruction.trim();
    }

    if (useWebSearch) {
      config.tools = [{ googleSearch: {} }];
    }

    const candidateModels =
      modelEngine === "gemini-4-carbon"
        ? ["gemini-4-carbon", "gemini-4-argon", "gemini-4-hydrogen"]
        : modelEngine === "gemini-4-argon"
        ? ["gemini-4-argon", "gemini-4-hydrogen"]
        : ["gemini-4-hydrogen"];

    let streamedSuccessfully = false;
    for (const candidate of candidateModels) {
      try {
        const responseStream = await ai.models.generateContentStream({
          model: candidate,
          contents: formattedContents,
          config,
        });

        for await (const chunk of responseStream) {
          const c = chunk as GenerateContentResponse;
          const chunkText = c.text;
          if (chunkText) {
            streamedSuccessfully = true;
            res.write(`data: ${JSON.stringify({ text: chunkText })}\n\n`);
          }
        }
        if (streamedSuccessfully) break;
      } catch {
        // Free-tier 429 quota exceeded -> try next candidate
      }
    }

    if (!streamedSuccessfully) {
      // Seamless Unlimited Fallback to NoTrack Deep Reasoning (Model A)
      await streamPureNoTrackNative({
        messages,
        notrackModelCode: "A",
        personaStyle: notrackStyle,
        customInstructions: systemInstruction,
        existingUid: notrackUid,
        existingChatId: notrackChatId,
        forceNewChatRollover,
        onChunk: (chunkText) => {
          res.write(`data: ${JSON.stringify({ text: chunkText })}\n\n`);
        },
        onMeta: (meta) => {
          res.write(`data: ${JSON.stringify({ meta })}\n\n`);
        },
      });
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (error: unknown) {
    const errMessage =
      error instanceof Error ? error.message : "Failed to generate response.";
    if (!res.headersSent) {
      res.status(500).json({ error: errMessage });
    } else {
      res.write(`data: ${JSON.stringify({ error: errMessage })}\n\n`);
      res.end();
    }
  }
});

app.post("/api/chat/compress", async (req, res) => {
  try {
    const {
      notrackUid,
      notrackChatId,
    }: {
      notrackUid?: string;
      notrackChatId?: string;
    } = req.body;

    if (notrackUid && notrackChatId) {
      // Use notrack.ai's own native carry_make endpoint!
      const resp = await fetch("https://notrack.ai/api/dispatch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://notrack.ai",
          Referer: "https://notrack.ai/chat",
          Cookie: `uid=${notrackUid}`,
          "User-Agent": NOTRACK_UA,
        },
        body: JSON.stringify({
          op: "carry_make",
          chat_id: notrackChatId,
          user_input: "carry",
          mode: "usual",
          model: "C",
          persona: "normal",
          locale: "bn",
        }),
      });

      if (resp.ok && resp.body) {
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let carryText = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let i: number;
          while ((i = buf.indexOf("\n\n")) !== -1) {
            const blk = buf.slice(0, i);
            buf = buf.slice(i + 2);
            const line = blk.split("\n").find((l) => l.startsWith("data: "));
            if (!line) continue;
            try {
              const ev = JSON.parse(line.slice(6));
              if (ev.type === "carry_delta" && ev.chunk) {
                carryText += ev.chunk;
              } else if (ev.type === "carry_done" && ev.text) {
                carryText = ev.text;
              }
            } catch {
              // ignore
            }
          }
        }
        if (carryText.trim()) {
          res.json({ summary: carryText.trim() });
          return;
        }
      }
    }

    res.json({ summary: "Memory carried over to new NoTrack Pro session." });
  } catch (error: unknown) {
    const errMessage =
      error instanceof Error ? error.message : "Failed to carry context.";
    res.status(500).json({ error: errMessage });
  }
});

// ============================================================================
// GitHub OAuth (3P Popup Flow) & GitHub Repository / Code Importer
// ============================================================================
app.get("/api/auth/github/url", (req, res) => {
  const clientId = process.env.GITHUB_CLIENT_ID || process.env.CLIENT_ID;
  if (!clientId) {
    res.status(400).json({
      error:
        "GITHUB_CLIENT_ID সেট করা নেই। তবে কোনো সেটআপ ছাড়াই নিচে সরাসরি যেকোনো GitHub Repo URL (যেমন: owner/repo) বা ফাইলের লিংক দিয়ে কোড ইমপোর্ট করতে পারবেন!",
    });
    return;
  }

  const redirectUri =
    (req.query.redirect_uri as string) ||
    `${process.env.APP_URL || "http://localhost:3000"}/auth/github/callback`;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "repo read:user",
  });

  res.json({
    url: `https://github.com/login/oauth/authorize?${params.toString()}`,
  });
});

app.get(
  ["/auth/github/callback", "/auth/github/callback/"],
  async (req, res) => {
    try {
      const code = req.query.code as string;
      const clientId = process.env.GITHUB_CLIENT_ID || process.env.CLIENT_ID;
      const clientSecret =
        process.env.GITHUB_CLIENT_SECRET || process.env.CLIENT_SECRET;

      if (!code || !clientId || !clientSecret) {
        res.status(400).send("Missing GitHub OAuth code or credentials.");
        return;
      }

      const tokenRes = await fetch(
        "https://github.com/login/oauth/access_token",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            client_id: clientId,
            client_secret: clientSecret,
            code,
          }),
        }
      );
      const tokenData = await tokenRes.json();
      const accessToken = tokenData.access_token || "";

      let username = "";
      if (accessToken) {
        const userRes = await fetch("https://api.github.com/user", {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "User-Agent": "notrack-pro-workspace",
          },
        });
        const userData = await userRes.json().catch(() => ({}));
        username = userData.login || "";
      }

      res.send(`<!DOCTYPE html>
<html>
  <body>
    <script>
      if (window.opener) {
        window.opener.postMessage(
          {
            type: 'OAUTH_AUTH_SUCCESS',
            token: ${JSON.stringify(accessToken)},
            username: ${JSON.stringify(username)}
          },
          '*'
        );
        window.close();
      } else {
        window.location.href = '/';
      }
    </script>
    <p>GitHub authentication successful. Closing window...</p>
  </body>
</html>`);
    } catch {
      res.status(500).send("GitHub OAuth callback error.");
    }
  }
);

app.post("/api/github/inspect", async (req, res) => {
  try {
    const { repoUrl, token }: { repoUrl: string; token?: string } = req.body;
    if (!repoUrl || !repoUrl.trim()) {
      res.status(400).json({ error: "GitHub URL বা owner/repo দিন।" });
      return;
    }

    const headers: Record<string, string> = {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "notrack-pro-workspace",
    };
    if (token && token.trim()) {
      headers.Authorization = `Bearer ${token.trim()}`;
    }

    const cleaned = repoUrl
      .trim()
      .replace(/^https?:\/\/github\.com\//i, "")
      .replace(/\.git$/i, "")
      .replace(/\/+$/, "");

    // Check if it is a direct blob/file URL: owner/repo/blob/branch/path/to/file
    const blobMatch = cleaned.match(
      /^([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/
    );
    if (blobMatch) {
      const [, owner, repo, branch, filePath] = blobMatch;
      const rawRes = await fetch(
        `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`,
        { headers: token ? { Authorization: `Bearer ${token}` } : {} }
      );
      if (!rawRes.ok) {
        res
          .status(404)
          .json({ error: "GitHub ফাইলটি খুঁজে পাওয়া যায়নি।" });
        return;
      }
      const content = await rawRes.text();
      res.json({
        singleFile: {
          name: `${repo}/${filePath}`,
          content: content.slice(0, 150000),
        },
      });
      return;
    }

    const parts = cleaned.split("/");
    if (parts.length < 2) {
      res
        .status(400)
        .json({ error: "সঠিক ফরম্যাটে দিন: owner/repo অথবা GitHub লিংক।" });
      return;
    }

    const owner = parts[0];
    const repo = parts[1];

    const repoRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}`,
      { headers }
    );
    if (!repoRes.ok) {
      res
        .status(repoRes.status)
        .json({ error: `GitHub repo পাওয়া যায়নি (${repoRes.status})` });
      return;
    }
    const repoMeta = await repoRes.json();
    const defaultBranch = repoMeta.default_branch || "main";

    const treeRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/git/trees/${defaultBranch}?recursive=1`,
      { headers }
    );
    const treeData = await treeRes.json();
    const files = Array.isArray(treeData.tree)
      ? treeData.tree.filter(
          (item: { type: string; path: string }) =>
            item.type === "blob" &&
            !item.path.includes("node_modules/") &&
            !item.path.endsWith(".lock") &&
            !item.path.endsWith(".png") &&
            !item.path.endsWith(".jpg") &&
            !item.path.endsWith(".ico")
        )
      : [];

    res.json({
      owner,
      repo,
      branch: defaultBranch,
      description: repoMeta.description || "",
      files,
    });
  } catch (err: unknown) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to inspect GitHub repo",
    });
  }
});

app.post("/api/github/fetch-files", async (req, res) => {
  try {
    const {
      owner,
      repo,
      branch,
      paths,
      token,
    }: {
      owner: string;
      repo: string;
      branch: string;
      paths: string[];
      token?: string;
    } = req.body;

    if (!owner || !repo || !Array.isArray(paths) || paths.length === 0) {
      res.status(400).json({ error: "Paths are required." });
      return;
    }

    const results: Array<{ path: string; content: string }> = [];
    for (const filePath of paths.slice(0, 15)) {
      const r = await fetch(
        `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`,
        {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        }
      );
      if (r.ok) {
        const text = await r.text();
        results.push({
          path: filePath,
          content: text.slice(0, 100000),
        });
      }
    }

    res.json({ files: results });
  } catch (err: unknown) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to fetch GitHub files",
    });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*all", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    // Auto-resume Telegram bot if previously started
    try {
      if (fs.existsSync(TG_CONFIG_FILE)) {
        const saved = JSON.parse(fs.readFileSync(TG_CONFIG_FILE, "utf-8"));
        if (saved && saved.botToken) {
          tgToken = saved.botToken;
          tgPollingActive = true;
          tgState.running = true;
          tgState.botUsername = saved.botUsername || null;
          tgState.botName = saved.botName || "Telegram Bot";
          tgState.defaultModel = saved.defaultModel || "notrack-c";
          tgState.systemPrompt = saved.systemPrompt || "";
          tgState.startedAt = Date.now();
          runTelegramPollingLoop(saved.botToken);
        }
      }
    } catch {
      // ignore
    }
  });
}

startServer();
