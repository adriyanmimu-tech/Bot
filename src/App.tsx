/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  Plus,
  Send,
  Paperclip,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Trash2,
  Pin,
  Search,
  Download,
  Sun,
  Moon,
  RotateCcw,
  Edit3,
  Check,
  X,
  FileText,
  Globe,
  Minimize2,
  Maximize2,
  Code2,
  Sliders,
  HardDrive,
} from "lucide-react";
import {
  ChatAttachment,
  ChatFolder,
  ChatMessage,
  ChatSession,
  NoTrackStyle,
  ReasoningDepth,
} from "./types";
import {
  MODEL_ENGINE_OPTIONS,
  PERSONA_PRESETS,
  calculateSessionTokens,
  downloadSingleMessage,
  estimateTokens,
  exportAsCsv,
  exportAsDoc,
  exportAsMarkdown,
  exportAsTxt,
  extractHtmlBlocks,
} from "./utils/exportUtils";
import { MessageRenderer } from "./components/MessageRenderer";
import { LiveSandboxPanel } from "./components/LiveSandboxModal";
import { TelegramBotView } from "./components/TelegramBotView";
import { DriveGithubModal } from "./components/DriveGithubModal";

const STORAGE_KEY_SESSIONS = "notrack_pure_original_v4";
const STORAGE_KEY_THEME = "notrack_studio_theme_v1";

type ActiveView = "workspace" | "instructions" | "telegram" | "pro-features";

function createInitialSession(): ChatSession {
  const now = Date.now();
  return {
    id: `session_${now}`,
    title: "New Chat",
    folder: "general",
    pinned: false,
    createdAt: now,
    updatedAt: now,
    modelEngine: "notrack-c",
    notrackStyle: "normal",
    notrackUid: undefined,
    notrackChatId: null,
    notrackNeedsCarry: false,
    personaId: "pure-original",
    customSystemPrompt: "",
    reasoningDepth: "HIGH",
    useWebSearch: false,
    messages: [],
  };
}

export default function App() {
  const [isDark, setIsDark] = useState<boolean>(() => {
    const saved = localStorage.getItem(STORAGE_KEY_THEME);
    return saved ? saved === "dark" : true;
  });

  useEffect(() => {
    const root = document.documentElement;
    if (isDark) {
      root.classList.add("dark");
      localStorage.setItem(STORAGE_KEY_THEME, "dark");
    } else {
      root.classList.remove("dark");
      localStorage.setItem(STORAGE_KEY_THEME, "light");
    }
  }, [isDark]);

  const [sessions, setSessions] = useState<ChatSession[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_SESSIONS);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map((s) => ({
            ...createInitialSession(),
            ...s,
            modelEngine:
              s.modelEngine === "notrack-hybrid"
                ? "notrack-c"
                : s.modelEngine || "notrack-c",
          }));
        }
      }
    } catch {
      // ignore
    }
    return [createInitialSession()];
  });

  const [activeSessionId, setActiveSessionId] = useState<string>(() => {
    return sessions[0]?.id || "";
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_SESSIONS, JSON.stringify(sessions));
    } catch {
      // ignore quota
    }
  }, [sessions]);

  const activeSession = useMemo(() => {
    return (
      sessions.find((s) => s.id === activeSessionId) ||
      sessions[0] ||
      createInitialSession()
    );
  }, [sessions, activeSessionId]);

  const [activeView, setActiveView] = useState<ActiveView>("workspace");
  const [folderFilter, setFolderFilter] = useState<ChatFolder>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [inputPrompt, setInputPrompt] = useState("");
  const [composerExpanded, setComposerExpanded] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<ChatAttachment[]>(
    []
  );
  const [isStreaming, setIsStreaming] = useState(false);
  const [isCompressing, setIsCompressing] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const [sandboxHtml, setSandboxHtml] = useState<string | null>(null);
  const [driveGithubModalOpen, setDriveGithubModalOpen] = useState(false);

  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingTitleText, setEditingTitleText] = useState("");
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingMessageText, setEditingMessageText] = useState("");

  const [isListening, setIsListening] = useState(false);
  const [voiceLang, setVoiceLang] = useState<"bn-BD" | "en-US">("bn-BD");
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(
    null
  );
  const [autoReadAloud, setAutoReadAloud] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeSession.messages.length, isStreaming]);

  const currentTokens = useMemo(
    () => calculateSessionTokens(activeSession),
    [activeSession]
  );

  const activeEngineOption = useMemo(
    () =>
      MODEL_ENGINE_OPTIONS.find((m) => m.id === activeSession.modelEngine) ||
      MODEL_ENGINE_OPTIONS[0],
    [activeSession.modelEngine]
  );

  const filteredSessions = useMemo(() => {
    return sessions
      .filter((s) => {
        if (folderFilter !== "all" && s.folder !== folderFilter) return false;
        if (!searchQuery.trim()) return true;
        const q = searchQuery.toLowerCase();
        if (s.title.toLowerCase().includes(q)) return true;
        return s.messages.some((m) => m.content.toLowerCase().includes(q));
      })
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return b.updatedAt - a.updatedAt;
      });
  }, [sessions, folderFilter, searchQuery]);

  const updateSession = (
    sessionId: string,
    updater: (prev: ChatSession) => ChatSession
  ) => {
    setSessions((prev) =>
      prev.map((s) => (s.id === sessionId ? updater(s) : s))
    );
  };

  const handleNewSession = () => {
    const fresh = createInitialSession();
    setSessions((prev) => [fresh, ...prev]);
    setActiveSessionId(fresh.id);
    setActiveView("workspace");
    setErrorBanner(null);
  };

  const handleDeleteSession = (id: string) => {
    setSessions((prev) => {
      const remaining = prev.filter((s) => s.id !== id);
      if (remaining.length === 0) {
        const fallback = createInitialSession();
        setActiveSessionId(fallback.id);
        return [fallback];
      }
      if (activeSessionId === id) {
        setActiveSessionId(remaining[0].id);
      }
      return remaining;
    });
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newAttachments: ChatAttachment[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const isTextLike =
        file.type.startsWith("text/") ||
        /\.(txt|md|csv|json|js|ts|tsx|jsx|py|html|css|sql|xml|yaml|yml|sh)$/i.test(
          file.name
        );

      if (isTextLike) {
        const textContent = await file.text();
        newAttachments.push({
          id: `att_${Date.now()}_${i}`,
          name: file.name,
          mimeType: file.type || "text/plain",
          size: file.size,
          textContent,
        });
      } else {
        const base64DataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        const base64Raw = base64DataUrl.split(",")[1] || "";
        newAttachments.push({
          id: `att_${Date.now()}_${i}`,
          name: file.name,
          mimeType: file.type || "application/octet-stream",
          size: file.size,
          data: base64Raw,
          previewUrl: file.type.startsWith("image/")
            ? base64DataUrl
            : undefined,
        });
      }
    }

    setPendingAttachments((prev) => [...prev, ...newAttachments]);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const toggleVoiceInput = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SpeechRec =
      (window as any).SpeechRecognition ||
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).webkitSpeechRecognition;

    if (!SpeechRec) {
      setErrorBanner(
        "Voice recognition is not supported in this browser. Try Chrome or Edge."
      );
      return;
    }

    const recognition = new SpeechRec();
    recognition.lang = voiceLang;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (event: any) => {
      const transcript = event.results?.[0]?.[0]?.transcript || "";
      if (transcript) {
        setInputPrompt((prev) =>
          prev ? `${prev} ${transcript}` : transcript
        );
      }
    };

    recognition.onerror = () => {
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  };

  const speakTextNow = (msgId: string, rawContent: string) => {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const cleanText = rawContent
      .replace(/<think>[\s\S]*?<\/think>/g, "")
      .replace(/```[\s\S]*?```/g, " ");
    if (!cleanText.trim()) return;
    const utterance = new SpeechSynthesisUtterance(cleanText);
    const hasBengali = /[\u0980-\u09FF]/.test(cleanText);
    utterance.lang = hasBengali ? "bn-BD" : "en-US";
    utterance.onend = () => setSpeakingMessageId(null);
    utterance.onerror = () => setSpeakingMessageId(null);
    setSpeakingMessageId(msgId);
    window.speechSynthesis.speak(utterance);
  };

  const toggleSpeakMessage = (msg: ChatMessage) => {
    if (!("speechSynthesis" in window)) return;
    if (speakingMessageId === msg.id) {
      window.speechSynthesis.cancel();
      setSpeakingMessageId(null);
      return;
    }
    speakTextNow(msg.id, msg.content);
  };

  const sendConversationToStream = async (
    targetSession: ChatSession,
    messagesToSend: ChatMessage[]
  ) => {
    setIsStreaming(true);
    setErrorBanner(null);

    const engineObj =
      MODEL_ENGINE_OPTIONS.find((m) => m.id === targetSession.modelEngine) ||
      MODEL_ENGINE_OPTIONS[0];

    const assistantMsgId = `msg_${Date.now()}_ai`;
    const placeholderMsg: ChatMessage = {
      id: assistantMsgId,
      role: "model",
      content: "",
      timestamp: Date.now(),
      estimatedTokens: 0,
      modelUsed: engineObj.shortName,
    };

    updateSession(targetSession.id, (s) => ({
      ...s,
      updatedAt: Date.now(),
      messages: [...messagesToSend, placeholderMsg],
    }));

    const activePersona =
      PERSONA_PRESETS.find((p) => p.id === targetSession.personaId) ||
      PERSONA_PRESETS[0];

    // Only send custom instructions if the user explicitly set one (pure-original sends "")
    const sysInstruction =
      targetSession.customSystemPrompt !== undefined
        ? targetSession.customSystemPrompt.trim()
        : activePersona.systemPrompt.trim();

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          messages: messagesToSend.map((m) => ({
            role: m.role,
            content: m.content,
            attachments: m.attachments?.map((a) => ({
              name: a.name,
              mimeType: a.mimeType,
              data: a.data,
              textContent: a.textContent,
            })),
          })),
          modelEngine: targetSession.modelEngine,
          notrackStyle: targetSession.notrackStyle || "normal",
          notrackUid: targetSession.notrackUid,
          notrackChatId: targetSession.notrackChatId,
          forceNewChatRollover: Boolean(targetSession.notrackNeedsCarry),
          systemInstruction: sysInstruction || undefined,
          reasoningDepth: targetSession.reasoningDepth,
          useWebSearch: targetSession.useWebSearch,
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `Server error (${response.status})`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("ReadableStream not supported.");

      const decoder = new TextDecoder();
      let accumulatedText = "";
      let sseBuffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        sseBuffer += decoder.decode(value, { stream: true });
        const lines = sseBuffer.split("\n\n");
        sseBuffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const jsonStr = trimmed.slice(5).trim();
          if (!jsonStr) continue;

          try {
            const parsed = JSON.parse(jsonStr);
            if (parsed.error) {
              throw new Error(parsed.error);
            }
            if (parsed.meta) {
              // Persist native notrackUid and notrackChatId for seamless multi-turn conversation!
              updateSession(targetSession.id, (s) => ({
                ...s,
                notrackUid: parsed.meta.uid || s.notrackUid,
                notrackChatId: parsed.meta.ctxCut
                  ? null
                  : parsed.meta.chatId || s.notrackChatId,
                notrackNeedsCarry: Boolean(parsed.meta.ctxCut),
              }));
            }
            if (parsed.text) {
              accumulatedText += parsed.text;
              updateSession(targetSession.id, (s) => ({
                ...s,
                updatedAt: Date.now(),
                messages: s.messages.map((m) =>
                  m.id === assistantMsgId
                    ? {
                        ...m,
                        content: accumulatedText,
                        estimatedTokens: estimateTokens(accumulatedText),
                      }
                    : m
                ),
              }));
            }
          } catch (innerErr) {
            if (
              innerErr instanceof Error &&
              innerErr.message !== "Unexpected end of JSON input"
            ) {
              throw innerErr;
            }
          }
        }
      }

      if (autoReadAloud && accumulatedText.trim()) {
        speakTextNow(assistantMsgId, accumulatedText);
      }

      const htmlBlocks = extractHtmlBlocks(accumulatedText);
      if (htmlBlocks.length > 0) {
        setSandboxHtml(htmlBlocks[htmlBlocks.length - 1]);
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") {
        // stopped intentionally
      } else {
        const msg =
          err instanceof Error ? err.message : "Failed to complete request.";
        setErrorBanner(msg);
      }
    } finally {
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  };

  const handleSendMessage = async (customPrompt?: string) => {
    const textToUse =
      typeof customPrompt === "string" ? customPrompt : inputPrompt;
    if (
      (!textToUse.trim() && pendingAttachments.length === 0) ||
      isStreaming
    ) {
      return;
    }

    const userMsg: ChatMessage = {
      id: `msg_${Date.now()}_user`,
      role: "user",
      content: textToUse.trim(),
      timestamp: Date.now(),
      attachments:
        pendingAttachments.length > 0 ? [...pendingAttachments] : undefined,
      estimatedTokens: estimateTokens(textToUse.trim()),
    };

    const updatedMessages = [...activeSession.messages, userMsg];
    const shouldUpdateTitle =
      activeSession.messages.length === 0 && textToUse.trim().length > 0;
    const nextTitle = shouldUpdateTitle
      ? textToUse.trim().slice(0, 42)
      : activeSession.title;

    const updatedSession: ChatSession = {
      ...activeSession,
      title: nextTitle,
      updatedAt: Date.now(),
      messages: updatedMessages,
    };

    updateSession(activeSession.id, () => updatedSession);
    setInputPrompt("");
    setComposerExpanded(false);
    setPendingAttachments([]);

    await sendConversationToStream(updatedSession, updatedMessages);
  };

  const handleRegenerateFrom = async (msgIndex: number) => {
    if (isStreaming) return;
    const targetMsg = activeSession.messages[msgIndex];
    const cutoffIndex = targetMsg.role === "user" ? msgIndex + 1 : msgIndex;
    const sliced = activeSession.messages.slice(0, cutoffIndex);
    if (sliced.length === 0) return;

    // Roll over to a fresh native chatId so regeneration is clean
    const rolledSession: ChatSession = {
      ...activeSession,
      notrackChatId: null,
      notrackNeedsCarry: true,
    };
    await sendConversationToStream(rolledSession, sliced);
  };

  const handleSaveEditedMessage = async (msgId: string) => {
    if (!editingMessageText.trim() || isStreaming) return;
    const idx = activeSession.messages.findIndex((m) => m.id === msgId);
    if (idx === -1) return;

    const editedMsg: ChatMessage = {
      ...activeSession.messages[idx],
      content: editingMessageText.trim(),
      estimatedTokens: estimateTokens(editingMessageText.trim()),
      timestamp: Date.now(),
    };

    const nextMessages = [...activeSession.messages.slice(0, idx), editedMsg];
    setEditingMessageId(null);
    setEditingMessageText("");

    const rolledSession: ChatSession = {
      ...activeSession,
      notrackChatId: null,
      notrackNeedsCarry: true,
    };
    await sendConversationToStream(rolledSession, nextMessages);
  };

  const handleCarryMemory = async () => {
    if (activeSession.messages.length < 2 || isCompressing || isStreaming)
      return;
    setIsCompressing(true);
    setErrorBanner(null);

    try {
      const response = await fetch("/api/chat/compress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notrackUid: activeSession.notrackUid,
          notrackChatId: activeSession.notrackChatId,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Carry memory failed.");
      }

      updateSession(activeSession.id, (s) => ({
        ...s,
        notrackChatId: null,
        notrackNeedsCarry: true,
        customSystemPrompt: data.summary
          ? `${s.customSystemPrompt ? s.customSystemPrompt + "\n\n" : ""}${data.summary}`
          : s.customSystemPrompt,
      }));
    } catch (err: unknown) {
      setErrorBanner(
        err instanceof Error ? err.message : "Failed to carry memory."
      );
    } finally {
      setIsCompressing(false);
    }
  };

  const activePersona =
    PERSONA_PRESETS.find((p) => p.id === activeSession.personaId) ||
    PERSONA_PRESETS[0];

  const isNoTrackEngine =
    activeSession.modelEngine === "notrack-c" ||
    activeSession.modelEngine === "notrack-a";

  return (
    <div className="h-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 overflow-hidden">
      {/* Mandatory 3-Zone Top Bar Contract */}
      <header className="flex items-center justify-between gap-8 px-6 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shrink-0">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#workspace"
          onClick={(e) => {
            e.preventDefault();
            setActiveView("workspace");
          }}
          className="text-lg font-display font-bold tracking-tight text-emerald-700 dark:text-emerald-400 whitespace-nowrap shrink-0"
        >
          notrack.ai Pro
        </a>

        {/* Zone 2: 4 concise single-line text navigation links */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600 dark:text-slate-400">
          <a
            href="#workspace"
            onClick={(e) => {
              e.preventDefault();
              setActiveView("workspace");
            }}
            className={`hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0 ${
              activeView === "workspace"
                ? "text-slate-900 dark:text-white underline underline-offset-8 decoration-2 decoration-emerald-600"
                : ""
            }`}
          >
            Uncensored Chat
          </a>
          <a
            href="#instructions"
            onClick={(e) => {
              e.preventDefault();
              setActiveView("instructions");
            }}
            className={`hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0 ${
              activeView === "instructions"
                ? "text-slate-900 dark:text-white underline underline-offset-8 decoration-2 decoration-emerald-600"
                : ""
            }`}
          >
            Roles & Instructions
          </a>
          <a
            href="#telegram"
            onClick={(e) => {
              e.preventDefault();
              setActiveView("telegram");
            }}
            className={`hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0 ${
              activeView === "telegram"
                ? "text-slate-900 dark:text-white underline underline-offset-8 decoration-2 decoration-emerald-600"
                : ""
            }`}
          >
            Telegram Bot & API
          </a>
          <a
            href="#pro-features"
            onClick={(e) => {
              e.preventDefault();
              setActiveView("pro-features");
            }}
            className={`hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0 ${
              activeView === "pro-features"
                ? "text-slate-900 dark:text-white underline underline-offset-8 decoration-2 decoration-emerald-600"
                : ""
            }`}
          >
            Pro Unlocked Status
          </a>
        </nav>

        {/* Zone 3: 1 primary action */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={handleNewSession}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-emerald-700 hover:bg-emerald-600 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>New Chat</span>
          </button>
        </div>
      </header>

      {/* Main Workspace Body */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Left Sidebar */}
        <aside className="hidden md:flex md:w-72 flex-col border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shrink-0">
          <div className="p-3.5 space-y-3 border-b border-slate-200 dark:border-slate-800">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search chats..."
                className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-emerald-600"
              />
            </div>

            <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-950 rounded-lg overflow-x-auto">
              {(
                ["all", "general", "coding", "research", "private"] as ChatFolder[]
              ).map((folder) => (
                <button
                  key={folder}
                  type="button"
                  onClick={() => setFolderFilter(folder)}
                  className={`px-2 py-1 text-[11px] font-medium rounded capitalize transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    folderFilter === folder
                      ? "bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs"
                      : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                  }`}
                >
                  {folder}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {filteredSessions.length === 0 ? (
              <div className="p-6 text-center space-y-2">
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  No chats found.
                </p>
                <button
                  type="button"
                  onClick={handleNewSession}
                  className="text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer"
                >
                  Start a new chat
                </button>
              </div>
            ) : (
              filteredSessions.map((session) => {
                const isSelected = session.id === activeSession.id;
                const isEditingThis = editingSessionId === session.id;

                return (
                  <div
                    key={session.id}
                    onClick={() => {
                      setActiveSessionId(session.id);
                      setActiveView("workspace");
                    }}
                    className={`group flex items-start justify-between gap-2 px-3 py-2.5 rounded-lg transition-colors cursor-pointer ${
                      isSelected
                        ? "bg-slate-100 dark:bg-slate-800/90 text-slate-900 dark:text-white"
                        : "text-slate-700 dark:text-slate-300 hover:bg-slate-100/60 dark:hover:bg-slate-800/40"
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      {isEditingThis ? (
                        <div
                          className="flex items-center gap-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="text"
                            value={editingTitleText}
                            onChange={(e) =>
                              setEditingTitleText(e.target.value)
                            }
                            className="w-full px-1.5 py-0.5 text-xs rounded border border-emerald-600 bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none"
                            autoFocus
                          />
                          <button
                            type="button"
                            onClick={() => {
                              if (editingTitleText.trim()) {
                                updateSession(session.id, (s) => ({
                                  ...s,
                                  title: editingTitleText.trim(),
                                }));
                              }
                              setEditingSessionId(null);
                            }}
                            className="p-1 text-emerald-600 dark:text-emerald-400"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <div className="font-medium text-xs truncate">
                          {session.title}
                        </div>
                      )}

                      <div className="flex items-center gap-1.5 mt-1 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                        <span className="capitalize">{session.folder}</span>
                        <span aria-hidden="true">·</span>
                        <span>{session.messages.length} msgs</span>
                        {session.pinned && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="text-emerald-600 dark:text-emerald-400">
                              Pinned
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    <div
                      className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setEditingSessionId(session.id);
                          setEditingTitleText(session.title);
                        }}
                        className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400"
                        title="Rename chat"
                      >
                        <Edit3 className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          updateSession(session.id, (s) => ({
                            ...s,
                            pinned: !s.pinned,
                          }))
                        }
                        className={`p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 ${
                          session.pinned
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-slate-500 dark:text-slate-400"
                        }`}
                        title="Pin chat"
                      >
                        <Pin className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteSession(session.id)}
                        className="p-1 rounded hover:bg-rose-100 dark:hover:bg-rose-950/60 text-slate-500 hover:text-rose-600 dark:hover:text-rose-400"
                        title="Delete chat"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="p-3.5 border-t border-slate-200 dark:border-slate-800 space-y-2.5 bg-slate-50/60 dark:bg-slate-950/50">
            <div className="flex items-center justify-between text-xs">
              <span className="text-emerald-700 dark:text-emerald-400 font-semibold">
                {activeSession.notrackChatId
                  ? "Native Session Connected"
                  : "Pro Unlimited Ready"}
              </span>
              <span className="font-mono text-slate-600 dark:text-slate-400 tabular-nums">
                {currentTokens.toLocaleString()} tok
              </span>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setIsDark((d) => !d)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                {isDark ? (
                  <>
                    <Sun className="w-3.5 h-3.5 text-amber-400" />
                    <span>Light</span>
                  </>
                ) : (
                  <>
                    <Moon className="w-3.5 h-3.5 text-slate-700" />
                    <span>Dark</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => setAutoReadAloud((a) => !a)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                  autoReadAloud
                    ? "bg-emerald-700 text-white"
                    : "text-slate-600 dark:text-slate-400 hover:bg-slate-200/70 dark:hover:bg-slate-800"
                }`}
                title="Automatically read replies aloud"
              >
                <Volume2 className="w-3.5 h-3.5" />
                <span>{autoReadAloud ? "Auto-Voice On" : "Auto-Voice"}</span>
              </button>
            </div>
          </div>
        </aside>

        {/* Center Main Viewport */}
        <main className="flex-1 flex flex-col min-w-0 bg-slate-50 dark:bg-slate-950 overflow-hidden">
          {/* Mobile Quick Switcher Bar */}
          <div className="flex md:hidden items-center justify-between gap-2 px-4 py-2 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-x-auto">
            {(
              [
                { id: "workspace", label: "Chat" },
                { id: "instructions", label: "Instructions (Roles)" },
                { id: "telegram", label: "Telegram Bot" },
                { id: "pro-features", label: "Pro Unlocked" },
              ] as { id: ActiveView; label: string }[]
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveView(tab.id)}
                className={`px-3 py-1 text-xs font-medium rounded-md whitespace-nowrap shrink-0 ${
                  activeView === tab.id
                    ? "bg-emerald-700 text-white"
                    : "text-slate-600 dark:text-slate-400"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeView === "workspace" && (
            <div className="flex-1 flex min-h-0 overflow-hidden">
              <div className="flex-1 flex flex-col min-w-0 h-full">
                {/* Workspace Sub-Toolbar */}
                <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80">
                  <div className="flex items-center gap-1 p-0.5 bg-slate-100 dark:bg-slate-800 rounded-lg overflow-x-auto">
                    {MODEL_ENGINE_OPTIONS.map((eng) => {
                      const active = activeSession.modelEngine === eng.id;
                      return (
                        <button
                          key={eng.id}
                          type="button"
                          onClick={() =>
                            updateSession(activeSession.id, (s) => ({
                              ...s,
                              modelEngine: eng.id,
                            }))
                          }
                          className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                            active
                              ? "bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-400 shadow-xs"
                              : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                          }`}
                          title={eng.description}
                        >
                          {eng.shortName}
                        </button>
                      );
                    })}
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={() => setActiveView("instructions")}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border border-emerald-600/40 bg-emerald-50/60 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100/70 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <Sliders className="w-3.5 h-3.5" />
                      <span>
                        Instructions:{" "}
                        {activeSession.customSystemPrompt?.trim()
                          ? "Custom Role Active"
                          : activePersona.shortLabel}
                      </span>
                    </button>

                    {isNoTrackEngine ? (
                      <div className="flex items-center gap-0.5 p-0.5 bg-slate-100 dark:bg-slate-800 rounded-lg">
                        {(
                          [
                            "normal",
                            "concise",
                            "detailed",
                            "creative",
                          ] as NoTrackStyle[]
                        ).map((st) => (
                          <button
                            key={st}
                            type="button"
                            onClick={() =>
                              updateSession(activeSession.id, (s) => ({
                                ...s,
                                notrackStyle: st,
                              }))
                            }
                            className={`px-2 py-1 text-[11px] capitalize font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                              (activeSession.notrackStyle || "normal") === st
                                ? "bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-400 shadow-xs"
                                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                            }`}
                          >
                            {st}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="flex items-center gap-0.5 p-0.5 bg-slate-100 dark:bg-slate-800 rounded-lg">
                        {(["LOW", "HIGH", "XHIGH"] as ReasoningDepth[]).map(
                          (depth) => (
                            <button
                              key={depth}
                              type="button"
                              onClick={() =>
                                updateSession(activeSession.id, (s) => ({
                                  ...s,
                                  reasoningDepth: depth,
                                }))
                              }
                              className={`px-2 py-1 text-[11px] font-mono font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                                activeSession.reasoningDepth === depth
                                  ? "bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-400 shadow-xs"
                                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                              }`}
                            >
                              {depth === "LOW"
                                ? "Fast"
                                : depth === "HIGH"
                                ? "Balanced"
                                : "Deep XHIGH"}
                            </button>
                          )
                        )}
                      </div>
                    )}

                    {activeSession.modelEngine === "gemini-4-hydrogen" && (
                      <button
                        type="button"
                        onClick={() =>
                          updateSession(activeSession.id, (s) => ({
                            ...s,
                            useWebSearch: !s.useWebSearch,
                          }))
                        }
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                          activeSession.useWebSearch
                            ? "border-emerald-600 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300"
                            : "border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400"
                        }`}
                      >
                        <Globe className="w-3.5 h-3.5" />
                        <span>Web Search</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() =>
                        setSandboxHtml(
                          sandboxHtml ||
                            `<!DOCTYPE html>\n<html>\n<head>\n  <meta charset="utf-8">\n  <script src="https://cdn.tailwindcss.com"></script>\n</head>\n<body class="bg-slate-950 text-white min-h-screen flex items-center justify-center p-6">\n  <div class="max-w-md w-full p-6 rounded-xl border border-slate-800 bg-slate-900 space-y-3">\n    <h1 class="text-xl font-bold">NoTrack Live HTML Sandbox</h1>\n    <p class="text-sm text-slate-400">Ask NoTrack to write any HTML/JS app or preview code right here.</p>\n  </div>\n</body>\n</html>`
                        )
                      }
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <Code2 className="w-3.5 h-3.5" />
                      <span>HTML Preview</span>
                    </button>

                    {activeSession.messages.length > 0 && (
                      <div className="flex items-center gap-1 border-l border-slate-200 dark:border-slate-800 pl-2">
                        <button
                          type="button"
                          onClick={() => exportAsMarkdown(activeSession)}
                          className="px-2 py-1 text-[11px] font-mono rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 cursor-pointer"
                        >
                          .MD
                        </button>
                        <button
                          type="button"
                          onClick={() => exportAsDoc(activeSession)}
                          className="px-2 py-1 text-[11px] font-mono rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 cursor-pointer"
                        >
                          .DOC
                        </button>
                        <button
                          type="button"
                          onClick={() => exportAsCsv(activeSession)}
                          className="px-2 py-1 text-[11px] font-mono rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 cursor-pointer"
                        >
                          .CSV
                        </button>
                        <button
                          type="button"
                          onClick={() => exportAsTxt(activeSession)}
                          className="px-2 py-1 text-[11px] font-mono rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 cursor-pointer"
                        >
                          .TXT
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Messages Stream Area */}
                <div className="flex-1 overflow-y-auto px-4 sm:px-8 py-6">
                  <div className="max-w-3xl mx-auto space-y-6">
                    {errorBanner && (
                      <div className="flex items-center justify-between gap-4 p-4 rounded-lg border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 text-sm">
                        <span>{errorBanner}</span>
                        <button
                          type="button"
                          onClick={() => setErrorBanner(null)}
                          className="p-1 hover:opacity-75"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    )}

                    {activeSession.messages.length === 0 ? (
                      <div className="py-6 space-y-8">
                        <div className="space-y-3">
                          <div className="flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-400 font-medium">
                            <span>100% Pure Original notrack.ai Connection</span>
                            <span aria-hidden="true">·</span>
                            <span>Zero Filters</span>
                            <span aria-hidden="true">·</span>
                            <span>Native Session Continuity</span>
                          </div>
                          <h1
                            className="text-2xl sm:text-3xl font-display font-bold text-slate-900 dark:text-white tracking-tight"
                            style={{ textWrap: "balance" }}
                          >
                            What’s on your mind? No limits, no lectures.
                          </h1>
                          <p className="text-sm sm:text-base text-slate-600 dark:text-slate-400 max-w-2xl leading-relaxed">
                            Your messages now go{" "}
                            <strong>100% raw and untouched</strong> directly to{" "}
                            <strong>notrack.ai/chat</strong>’s original server
                            with native session IDs (`chat_id`) and native photo
                            uploads—so it responds identically to the original
                            website, with all Pro limits unlocked.
                          </p>
                        </div>

                        {/* Quick Role / Story Switcher Cards */}
                        <div className="space-y-2.5">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                              Instructions Mode (Default: Pure Original with
                              Zero Extra Prompt)
                            </span>
                            <button
                              type="button"
                              onClick={() => setActiveView("instructions")}
                              className="text-xs font-medium text-emerald-700 dark:text-emerald-400 hover:underline cursor-pointer"
                            >
                              Edit Custom Role / Story →
                            </button>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {PERSONA_PRESETS.map((preset) => {
                              const isSelected =
                                activeSession.personaId === preset.id;
                              return (
                                <button
                                  key={preset.id}
                                  type="button"
                                  onClick={() =>
                                    updateSession(activeSession.id, (s) => ({
                                      ...s,
                                      personaId: preset.id,
                                      customSystemPrompt: preset.systemPrompt,
                                      notrackChatId: null,
                                    }))
                                  }
                                  className={`text-left p-4 rounded-xl border transition-colors cursor-pointer ${
                                    isSelected
                                      ? "border-emerald-600 bg-white dark:bg-slate-900"
                                      : "border-slate-200 dark:border-slate-800 bg-white/60 dark:bg-slate-900/50 hover:border-slate-300 dark:hover:border-slate-700"
                                  }`}
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="font-display font-semibold text-sm text-slate-900 dark:text-white">
                                      {preset.name}
                                    </span>
                                    {isSelected && (
                                      <span className="text-xs font-mono text-emerald-700 dark:text-emerald-400">
                                        Active
                                      </span>
                                    )}
                                  </div>
                                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                                    {preset.description}
                                  </p>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    ) : (
                      activeSession.messages.map((msg, index) => {
                        const isUser = msg.role === "user";
                        const isEditing = editingMessageId === msg.id;

                        return (
                          <div
                            key={msg.id}
                            className={`p-5 rounded-xl border ${
                              isUser
                                ? "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800"
                                : "bg-slate-100/70 dark:bg-slate-900/50 border-slate-200/80 dark:border-slate-800/80"
                            }`}
                          >
                            <div className="flex items-center justify-between gap-4 mb-3 pb-2 border-b border-slate-200/60 dark:border-slate-800/60 text-xs text-slate-500 dark:text-slate-400">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-semibold text-slate-900 dark:text-white">
                                  {isUser ? "You" : "NoTrack"}
                                </span>
                                <span aria-hidden="true">·</span>
                                <span className="tabular-nums">
                                  {new Date(msg.timestamp).toLocaleTimeString(
                                    [],
                                    {
                                      hour: "2-digit",
                                      minute: "2-digit",
                                    }
                                  )}
                                </span>
                                <span aria-hidden="true">·</span>
                                <span className="font-mono tabular-nums">
                                  {msg.content.length.toLocaleString()} chars
                                </span>
                              </div>

                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => toggleSpeakMessage(msg)}
                                  className="inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 cursor-pointer"
                                  title="Unlimited Pro Read Aloud"
                                >
                                  {speakingMessageId === msg.id ? (
                                    <>
                                      <VolumeX className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                                      <span className="text-[11px] text-emerald-600 dark:text-emerald-400">
                                        Stop
                                      </span>
                                    </>
                                  ) : (
                                    <>
                                      <Volume2 className="w-3.5 h-3.5" />
                                      <span className="text-[11px]">
                                        Read Aloud
                                      </span>
                                    </>
                                  )}
                                </button>

                                {isUser && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingMessageId(msg.id);
                                      setEditingMessageText(msg.content);
                                    }}
                                    className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 cursor-pointer"
                                    title="Edit and regenerate"
                                  >
                                    <Edit3 className="w-3.5 h-3.5" />
                                  </button>
                                )}

                                <button
                                  type="button"
                                  onClick={() => handleRegenerateFrom(index)}
                                  disabled={isStreaming}
                                  className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 disabled:opacity-40 cursor-pointer"
                                  title="Regenerate response"
                                >
                                  <RotateCcw className="w-3.5 h-3.5" />
                                </button>

                                {!isUser && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      downloadSingleMessage(msg, "md")
                                    }
                                    className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 cursor-pointer"
                                    title="Download response (.md)"
                                  >
                                    <Download className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            </div>

                            {msg.attachments && msg.attachments.length > 0 && (
                              <div className="flex flex-wrap gap-2.5 mb-3">
                                {msg.attachments.map((att) => (
                                  <div
                                    key={att.id}
                                    className="flex items-center gap-2 p-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-xs"
                                  >
                                    {att.previewUrl ? (
                                      <img
                                        src={att.previewUrl}
                                        alt={att.name}
                                        referrerPolicy="no-referrer"
                                        className="w-12 h-12 object-cover rounded"
                                      />
                                    ) : (
                                      <FileText className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                                    )}
                                    <div className="min-w-0">
                                      <div className="font-medium text-slate-900 dark:text-slate-100 truncate max-w-[180px]">
                                        {att.name}
                                      </div>
                                      <div className="text-[11px] text-slate-500 font-mono tabular-nums">
                                        {(att.size / 1024).toFixed(1)} KB
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}

                            {isEditing ? (
                              <div className="space-y-2.5">
                                <textarea
                                  value={editingMessageText}
                                  onChange={(e) =>
                                    setEditingMessageText(e.target.value)
                                  }
                                  rows={4}
                                  className="w-full p-3 rounded-lg border border-emerald-600 bg-slate-50 dark:bg-slate-950 text-sm text-slate-900 dark:text-white focus:outline-none"
                                />
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleSaveEditedMessage(msg.id)
                                    }
                                    className="px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-medium cursor-pointer"
                                  >
                                    Save & Regenerate
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setEditingMessageId(null)}
                                    className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-600 dark:text-slate-400 cursor-pointer"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            ) : msg.content ? (
                              <MessageRenderer
                                content={msg.content}
                                onRunHtml={(html) => setSandboxHtml(html)}
                              />
                            ) : (
                              <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 py-2 font-mono">
                                <span>NoTrack is thinking...</span>
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                    <div ref={messagesEndRef} />
                  </div>
                </div>

                {/* Bottom Input Composer */}
                <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                  <div className="max-w-3xl mx-auto space-y-2">
                    {pendingAttachments.length > 0 && (
                      <div className="flex flex-wrap items-center gap-2 pb-1">
                        {pendingAttachments.map((att) => (
                          <div
                            key={att.id}
                            className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-xs"
                          >
                            {att.previewUrl ? (
                              <img
                                src={att.previewUrl}
                                alt={att.name}
                                referrerPolicy="no-referrer"
                                className="w-6 h-6 object-cover rounded"
                              />
                            ) : (
                              <FileText className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                            )}
                            <span className="truncate max-w-[150px] text-slate-800 dark:text-slate-200">
                              {att.name}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                setPendingAttachments((prev) =>
                                  prev.filter((p) => p.id !== att.id)
                                )
                              }
                              className="text-slate-400 hover:text-rose-500"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="flex items-end gap-2 p-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 focus-within:border-emerald-600 dark:focus-within:border-emerald-500 transition-colors">
                      <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        accept="image/*,.pdf,.txt,.md,.csv,.json,.js,.ts,.tsx,.py,.html,.css,.sql,.doc,.docx"
                        onChange={handleFileSelect}
                        className="hidden"
                      />
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="p-2 rounded-lg text-slate-600 dark:text-slate-400 hover:bg-slate-200/70 dark:hover:bg-slate-800 transition-colors shrink-0 cursor-pointer"
                        title="Upload Photo Album directly to notrack.ai (Auto UID rotation bypasses daily quota)"
                      >
                        <Paperclip className="w-4 h-4" />
                      </button>

                      <button
                        type="button"
                        onClick={() => setDriveGithubModalOpen(true)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 transition-colors shrink-0 cursor-pointer"
                        title="Connect Google Drive or GitHub Repository"
                      >
                        <HardDrive className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">Drive / GitHub</span>
                      </button>

                      <div className="flex items-center shrink-0">
                        <button
                          type="button"
                          onClick={() =>
                            setVoiceLang((l) =>
                              l === "bn-BD" ? "en-US" : "bn-BD"
                            )
                          }
                          className="px-1.5 py-1 text-[11px] font-mono text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white cursor-pointer"
                        >
                          {voiceLang === "bn-BD" ? "বাংলা" : "EN"}
                        </button>
                        <button
                          type="button"
                          onClick={toggleVoiceInput}
                          className={`p-2 rounded-lg transition-colors cursor-pointer ${
                            isListening
                              ? "bg-rose-600 text-white"
                              : "text-slate-600 dark:text-slate-400 hover:bg-slate-200/70 dark:hover:bg-slate-800"
                          }`}
                        >
                          {isListening ? (
                            <MicOff className="w-4 h-4" />
                          ) : (
                            <Mic className="w-4 h-4" />
                          )}
                        </button>
                      </div>

                      <textarea
                        value={inputPrompt}
                        onChange={(e) => setInputPrompt(e.target.value)}
                        onKeyDown={(e) => {
                          if (
                            e.key === "Enter" &&
                            !e.shiftKey &&
                            !composerExpanded
                          ) {
                            e.preventDefault();
                            handleSendMessage();
                          }
                        }}
                        rows={composerExpanded ? 10 : 2}
                        placeholder="অরিজিনাল notrack.ai-এর মতো যেকোনো খোলামেলা কথা, গল্প বা রোলপ্লে লিখুন..."
                        className={`flex-1 bg-transparent text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none resize-none py-1.5 ${
                          composerExpanded ? "max-h-96" : "max-h-40"
                        }`}
                      />

                      <button
                        type="button"
                        onClick={() => setComposerExpanded((c) => !c)}
                        className="p-2 rounded-lg text-slate-500 hover:bg-slate-200/70 dark:hover:bg-slate-800 transition-colors shrink-0 cursor-pointer"
                        title="Expand composer for 20,000+ character messages"
                      >
                        {composerExpanded ? (
                          <Minimize2 className="w-4 h-4" />
                        ) : (
                          <Maximize2 className="w-4 h-4" />
                        )}
                      </button>

                      {isStreaming ? (
                        <button
                          type="button"
                          onClick={() => abortControllerRef.current?.abort()}
                          className="px-3.5 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          Stop
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleSendMessage()}
                          disabled={
                            !inputPrompt.trim() &&
                            pendingAttachments.length === 0
                          }
                          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-white text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          <Send className="w-3.5 h-3.5" />
                          <span>Send</span>
                        </button>
                      )}
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 px-1 font-mono tabular-nums">
                      <span>
                        100% Raw Native notrack.ai Dispatch · No Extra Wrapper
                      </span>
                      <span>
                        {inputPrompt.length.toLocaleString()} / 20,000+ chars
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {sandboxHtml !== null && (
                <LiveSandboxPanel
                  htmlCode={sandboxHtml}
                  onClose={() => setSandboxHtml(null)}
                  onUpdateCode={(updated) => setSandboxHtml(updated)}
                />
              )}
            </div>
          )}

          {/* View 2: Instructions Without Limits */}
          {activeView === "instructions" && (
            <div className="flex-1 overflow-y-auto p-6 sm:p-10">
              <div className="max-w-3xl mx-auto space-y-6">
                <div className="space-y-1.5">
                  <div className="text-xs font-mono text-emerald-700 dark:text-emerald-400">
                    NoTrack Pro Unlocked · Saves Left Today: Unlimited (∞)
                  </div>
                  <h1 className="text-2xl font-display font-bold text-slate-900 dark:text-white">
                    Instructions Without Limits — Roles & Stories
                  </h1>
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    Leave empty for <strong>100% Pure Original notrack.ai</strong>{" "}
                    behavior, or write any custom role/story instruction.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {PERSONA_PRESETS.map((preset) => {
                    const isSelected = activeSession.personaId === preset.id;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() =>
                          updateSession(activeSession.id, (s) => ({
                            ...s,
                            personaId: preset.id,
                            customSystemPrompt: preset.systemPrompt,
                            notrackChatId: null,
                          }))
                        }
                        className={`p-4 text-left rounded-xl border transition-colors cursor-pointer ${
                          isSelected
                            ? "border-emerald-600 bg-white dark:bg-slate-900"
                            : "border-slate-200 dark:border-slate-800 bg-white/60 dark:bg-slate-900/50"
                        }`}
                      >
                        <div className="font-display font-semibold text-sm text-slate-900 dark:text-white">
                          {preset.name}
                        </div>
                        <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                          {preset.description}
                        </p>
                      </button>
                    );
                  })}
                </div>

                <div className="p-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-semibold text-slate-900 dark:text-white">
                      Custom Role / Story Instructions (Passed to native
                      notrack.ai `instructions` field)
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        updateSession(activeSession.id, (s) => ({
                          ...s,
                          personaId: "pure-original",
                          customSystemPrompt: "",
                          notrackChatId: null,
                        }))
                      }
                      className="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white cursor-pointer"
                    >
                      Clear (Use Pure Original)
                    </button>
                  </div>
                  <textarea
                    rows={8}
                    value={activeSession.customSystemPrompt ?? ""}
                    onChange={(e) =>
                      updateSession(activeSession.id, (s) => ({
                        ...s,
                        customSystemPrompt: e.target.value,
                        notrackChatId: null,
                      }))
                    }
                    placeholder="Empty = 100% pure original notrack.ai/chat with no system instructions. Or write any custom roleplay/story instruction here..."
                    className="w-full p-4 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm leading-relaxed text-slate-900 dark:text-slate-100 focus:outline-none focus:border-emerald-600"
                  />
                  <div className="flex items-center justify-between pt-2">
                    <span className="text-xs text-slate-500 font-mono tabular-nums">
                      {(activeSession.customSystemPrompt ?? "").length} chars ·
                      Unlimited saves
                    </span>
                    <button
                      type="button"
                      onClick={() => setActiveView("workspace")}
                      className="px-5 py-2.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-semibold transition-colors cursor-pointer"
                    >
                      Save & Return to Chat
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* View 3: Telegram Bot & API Gateway */}
          {activeView === "telegram" && <TelegramBotView />}

          {/* View 4: Pro Unlocked Status Checklist */}
          {activeView === "pro-features" && (
            <div className="flex-1 overflow-y-auto p-6 sm:p-10">
              <div className="max-w-3xl mx-auto space-y-6">
                <div className="p-6 sm:p-8 rounded-2xl border-2 border-emerald-600 bg-white dark:bg-slate-900 space-y-6">
                  <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-4">
                    <div>
                      <div className="text-xs font-mono font-semibold text-emerald-700 dark:text-emerald-400">
                        ACTIVE PLAN STATUS
                      </div>
                      <h1 className="text-2xl font-display font-bold text-slate-900 dark:text-white mt-1">
                        notrack.ai Pro — All Features Unlocked
                      </h1>
                    </div>
                    <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                      100% Active
                    </span>
                  </div>

                  <div className="space-y-4 text-sm">
                    {[
                      {
                        title: "1,000+ photos a day (Native /api/upload with Auto-UID Rotation)",
                        desc: "Uploads photos directly to notrack.ai/api/upload and automatically rotates session UID if the free-tier vision quota is ever reached.",
                      },
                      {
                        title:
                          "500+ replies read aloud a day (Unlimited Voice Read Aloud)",
                        desc: "Click 'Read Aloud' on any reply or turn on 'Auto-Voice' in the sidebar for hands-free listening.",
                      },
                      {
                        title:
                          "20 MB+ a photo — twice the file Plus takes",
                        desc: "Upload high-resolution photos and documents directly into your NoTrack conversation.",
                      },
                      {
                        title:
                          "Unlimited memory — the whole conversation, every time",
                        desc: "Maintains native notrack.ai chat_id continuity and automatically carries memory over whenever ctx_cut triggers.",
                      },
                      {
                        title:
                          "Instructions without limits — change roles and stories as often as you like",
                        desc: "Change roles and stories as often as you like without hitting the daily instr_quota.",
                      },
                      {
                        title:
                          "Messages up to 20,000 characters — whole chapters and documents at once",
                        desc: "Send full chapters and long messages directly without character truncation.",
                      },
                    ].map((feat, i) => (
                      <div key={i} className="flex items-start gap-3">
                        <Check className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                        <div>
                          <div className="font-semibold text-slate-900 dark:text-white">
                            {feat.title}
                          </div>
                          <div className="text-xs text-slate-600 dark:text-slate-400 mt-0.5 leading-relaxed">
                            {feat.desc}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="pt-4 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={handleCarryMemory}
                      disabled={
                        activeSession.messages.length < 2 || isCompressing
                      }
                      className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-emerald-600 text-emerald-700 dark:text-emerald-400 text-xs font-semibold hover:bg-emerald-50 dark:hover:bg-emerald-950/40 disabled:opacity-40 transition-colors cursor-pointer"
                    >
                      <span>
                        {isCompressing
                          ? "Carrying Memory..."
                          : "Carry Conversation Memory Now"}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setActiveView("workspace")}
                      className="px-6 py-2.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-semibold transition-colors cursor-pointer"
                    >
                      Open Uncensored Chat
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      <DriveGithubModal
        isOpen={driveGithubModalOpen}
        onClose={() => setDriveGithubModalOpen(false)}
        activeSession={activeSession}
        onAttachFiles={(newAtts) =>
          setPendingAttachments((prev) => [...prev, ...newAtts])
        }
      />
    </div>
  );
}
