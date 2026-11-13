export interface ChatAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  data?: string; // base64 string (without data:... prefix)
  previewUrl?: string; // data URL for image preview
  textContent?: string; // plain text for code/txt/csv/md files
}

export type ModelEngineId =
  | "notrack-c"
  | "notrack-a"
  | "gemini-4-carbon"
  | "gemini-4-argon"
  | "gemini-4-hydrogen";

export type NoTrackStyle = "normal" | "concise" | "detailed" | "creative";

export interface ModelEngineOption {
  id: ModelEngineId;
  name: string;
  shortName: string;
  badge: string;
  description: string;
  contextLimitLabel: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "model";
  content: string;
  timestamp: number;
  attachments?: ChatAttachment[];
  estimatedTokens: number;
  isCompressedSnapshot?: boolean;
  modelUsed?: string;
}

export type ChatFolder = "all" | "general" | "coding" | "research" | "private";

export type ReasoningDepth = "LOW" | "HIGH" | "XHIGH";

export interface PersonaPreset {
  id: string;
  name: string;
  shortLabel: string;
  description: string;
  systemPrompt: string;
}

export interface ChatSession {
  id: string;
  title: string;
  folder: Exclude<ChatFolder, "all">;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
  modelEngine: ModelEngineId;
  notrackStyle: NoTrackStyle;
  notrackUid?: string;
  notrackChatId?: string | null;
  notrackNeedsCarry?: boolean;
  personaId: string;
  customSystemPrompt?: string;
  reasoningDepth: ReasoningDepth;
  useWebSearch: boolean;
  messages: ChatMessage[];
}
