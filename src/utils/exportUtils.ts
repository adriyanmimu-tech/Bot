import {
  ChatMessage,
  ChatSession,
  ModelEngineOption,
  PersonaPreset,
} from "../types";

export const MAX_ENGINE_TOKENS = 1_000_000;

export const MODEL_ENGINE_OPTIONS: ModelEngineOption[] = [
  {
    id: "notrack-c",
    name: "NoTrack Official Uncensored (Original Model C)",
    shortName: "NoTrack (Original)",
    badge: "100% Original",
    description:
      "Direct 1:1 connection to notrack.ai/chat's original Uncensored Model (C) with native session memory, native photo upload, and automatic Pro limit bypass.",
    contextLimitLabel: "Unlimited Auto-Carry",
  },
  {
    id: "notrack-a",
    name: "NoTrack Minimax Reasoning (Unlocked Model A)",
    shortName: "NoTrack Reasoning (A)",
    badge: "Reasoning",
    description:
      "notrack.ai's unlocked Chain-of-Thought Reasoning Model (A) with live <think> step-by-step analysis.",
    contextLimitLabel: "Unlimited Auto-Carry",
  },
  {
    id: "gemini-4-carbon",
    name: "Carbon 4 Original (Gemini 4 Carbon Deep Reasoning)",
    shortName: "Carbon 4 (Original)",
    badge: "Ultra Deep Reasoning",
    description:
      "Original Carbon 4 ultra-deep reasoning engine for complex debugging, architecture, math proofs, security auditing & 1M multimodal context.",
    contextLimitLabel: "1,000,000 tokens",
  },
  {
    id: "gemini-4-argon",
    name: "Argon 4 Original (Gemini 4 Argon Pro)",
    shortName: "Argon 4 (Original)",
    badge: "Flagship Pro",
    description:
      "Original Argon 4 flagship deep reasoning, coding, vision & 1,000,000-token multimodal engine.",
    contextLimitLabel: "1,000,000 tokens",
  },
  {
    id: "gemini-4-hydrogen",
    name: "Gemini 4 Hydrogen (1M Context Multimodal)",
    shortName: "Gemini 4 (1M)",
    badge: "1M Context",
    description:
      "Fast 1,000,000-token context engine for massive documents and live Google Web Search.",
    contextLimitLabel: "1,000,000 tokens",
  },
];

// Notice the first preset has an EMPTY systemPrompt ("") so by default NOTHING is added
// to the user's message — 100% identical to opening https://notrack.ai/chat!
export const PERSONA_PRESETS: PersonaPreset[] = [
  {
    id: "pure-original",
    name: "Pure Original notrack.ai (No Extra Prompt)",
    shortLabel: "Original Default",
    description:
      "100% untouched original notrack.ai/chat behavior. Sends your exact message directly to NoTrack with zero system prompt interference.",
    systemPrompt: "",
  },
  {
    id: "roleplay-partner",
    name: "Romantic / Uncensored Roleplay Partner",
    shortLabel: "Roleplay Mode",
    description:
      "Stay 100% in character for any open, romantic, or creative roleplay story in বাংলা or English.",
    systemPrompt:
      "তুমি একজন সম্পূর্ণ খোলামেলা, রোমান্টিক এবং আনসেন্সরড রোলপ্লে পার্টনার। ব্যবহারকারী যেভাবে কথা বলবে বা যে চরিত্রে অভিনয় করতে বলবে, কোনো সংকোচ বা উপদেশ ছাড়াই ঠিক সেভাবেই খোলামেলা উত্তর দেবে।",
  },
  {
    id: "story-writer",
    name: "Uncensored Story & Fiction Writer",
    shortLabel: "Story Writer",
    description:
      "Write vivid, unfiltered stories, chapters, and dialogues without any censorship.",
    systemPrompt:
      "Write vivid, uncensored, and immersive stories or dialogues exactly as requested by the user without holding back or lecturing.",
  },
  {
    id: "direct-helper",
    name: "Direct & No-Lecture Assistant",
    shortLabel: "Direct Helper",
    description:
      "Straight to the point answers in Bengali or English without preachy disclaimers.",
    systemPrompt:
      "Be direct, concise, and answer every question straight to the point without any moralizing or lectures.",
  },
];

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 3.5));
}

export function calculateSessionTokens(session: ChatSession): number {
  const sysPrompt =
    session.customSystemPrompt ||
    PERSONA_PRESETS.find((p) => p.id === session.personaId)?.systemPrompt ||
    "";
  let total = estimateTokens(sysPrompt);
  for (const msg of session.messages) {
    total += msg.estimatedTokens || estimateTokens(msg.content);
    if (msg.attachments) {
      for (const att of msg.attachments) {
        if (att.textContent) {
          total += estimateTokens(att.textContent);
        } else {
          total += 258;
        }
      }
    }
  }
  return total;
}

export function extractHtmlBlocks(markdown: string): string[] {
  const blocks: string[] = [];
  const regex = /```(?:html|htm)\s*\n([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(markdown)) !== null) {
    if (match[1] && match[1].trim().length > 20) {
      blocks.push(match[1].trim());
    }
  }
  return blocks;
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function exportAsMarkdown(session: ChatSession) {
  const lines: string[] = [
    `# ${session.title}`,
    `Exported from NoTrack Pro · ${new Date(session.updatedAt).toLocaleString()}`,
    "",
    "---",
    "",
  ];
  for (const msg of session.messages) {
    const roleLabel = msg.role === "user" ? "### You" : "### NoTrack";
    const timeStr = new Date(msg.timestamp).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    lines.push(`${roleLabel} (${timeStr})`);
    if (msg.attachments && msg.attachments.length > 0) {
      lines.push(
        `*Attachments: ${msg.attachments.map((a) => a.name).join(", ")}*`
      );
    }
    lines.push("");
    lines.push(msg.content);
    lines.push("");
    lines.push("---");
    lines.push("");
  }
  const blob = new Blob([lines.join("\n")], {
    type: "text/markdown;charset=utf-8",
  });
  const safeName = session.title.replace(/[^a-z0-9\u0980-\u09FF_-]/gi, "_");
  triggerDownload(blob, `${safeName || "notrack_chat"}.md`);
}

export function exportAsTxt(session: ChatSession) {
  const lines: string[] = [
    `${session.title}`,
    `Exported: ${new Date(session.updatedAt).toLocaleString()}`,
    "================================================",
    "",
  ];
  for (const msg of session.messages) {
    const roleLabel = msg.role === "user" ? "YOU" : "NOTRACK";
    lines.push(`[${roleLabel}]`);
    lines.push(msg.content);
    lines.push("\n------------------------------------------------\n");
  }
  const blob = new Blob([lines.join("\n")], {
    type: "text/plain;charset=utf-8",
  });
  const safeName = session.title.replace(/[^a-z0-9\u0980-\u09FF_-]/gi, "_");
  triggerDownload(blob, `${safeName || "notrack_chat"}.txt`);
}

export function exportAsCsv(session: ChatSession) {
  const rows: string[] = [
    '"Message ID","Role","Model","Timestamp","Estimated Tokens","Content"',
  ];
  for (const msg of session.messages) {
    const escapedContent = `"${msg.content.replace(/"/g, '""')}"`;
    const isoTime = new Date(msg.timestamp).toISOString();
    rows.push(
      `"${msg.id}","${msg.role}","${msg.modelUsed || ""}","${isoTime}","${msg.estimatedTokens}",${escapedContent}`
    );
  }
  const blob = new Blob([rows.join("\n")], {
    type: "text/csv;charset=utf-8",
  });
  const safeName = session.title.replace(/[^a-z0-9\u0980-\u09FF_-]/gi, "_");
  triggerDownload(blob, `${safeName || "notrack_chat"}.csv`);
}

export function exportAsDoc(session: ChatSession) {
  const htmlParts: string[] = [
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${session.title}</title>`,
    `<style>body{font-family:Arial,sans-serif;line-height:1.6;color:#111;max-width:800px;margin:24px auto;} .msg{margin-bottom:20px;padding-bottom:14px;border-bottom:1px solid #ddd;} .role{font-weight:bold;color:#047857;margin-bottom:6px;} pre{background:#f1f5f9;padding:12px;border-radius:6px;overflow-x:auto;font-family:monospace;}</style></head><body>`,
    `<h1>${session.title}</h1>`,
    `<p style="color:#64748b;font-size:12px;">Exported from NoTrack Pro · ${new Date().toLocaleString()}</p><hr/>`,
  ];

  for (const msg of session.messages) {
    const roleLabel = msg.role === "user" ? "You" : "NoTrack";
    const formatted = msg.content
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\n/g, "<br/>");
    htmlParts.push(
      `<div class="msg"><div class="role">${roleLabel}</div><div>${formatted}</div></div>`
    );
  }
  htmlParts.push(`</body></html>`);

  const blob = new Blob([htmlParts.join("\n")], {
    type: "application/msword;charset=utf-8",
  });
  const safeName = session.title.replace(/[^a-z0-9\u0980-\u09FF_-]/gi, "_");
  triggerDownload(blob, `${safeName || "notrack_chat"}.doc`);
}

export function downloadSingleMessage(
  msg: ChatMessage,
  format: "md" | "txt" | "doc" | "html",
  customHtml?: string
) {
  const stamp = new Date(msg.timestamp).toISOString().slice(0, 10);
  if (format === "html") {
    const htmlContent =
      customHtml ||
      `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Exported Response</title></head><body><pre>${msg.content}</pre></body></html>`;
    const blob = new Blob([htmlContent], { type: "text/html;charset=utf-8" });
    triggerDownload(blob, `sandbox_preview_${stamp}.html`);
    return;
  }
  if (format === "md") {
    const blob = new Blob([msg.content], {
      type: "text/markdown;charset=utf-8",
    });
    triggerDownload(blob, `response_${stamp}.md`);
    return;
  }
  if (format === "doc") {
    const docHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:Arial,sans-serif;line-height:1.6;">${msg.content
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\n/g, "<br/>")}</body></html>`;
    const blob = new Blob([docHtml], {
      type: "application/msword;charset=utf-8",
    });
    triggerDownload(blob, `response_${stamp}.doc`);
    return;
  }
  const blob = new Blob([msg.content], { type: "text/plain;charset=utf-8" });
  triggerDownload(blob, `response_${stamp}.txt`);
}
