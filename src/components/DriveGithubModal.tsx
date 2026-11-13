import React, { useState, useEffect } from "react";
import {
  X,
  Search,
  RefreshCw,
  Download,
  Upload,
  FolderGit2,
  HardDrive,
  Check,
  ExternalLink,
  LogOut,
  FileText,
  Image as ImageIcon,
  Code2,
} from "lucide-react";
import { User } from "firebase/auth";
import { ChatAttachment, ChatSession } from "../types";
import {
  initAuth,
  googleSignIn,
  logoutGoogleDrive,
  listGoogleDriveFiles,
  importDriveFileAsAttachment,
  saveChatTranscriptToDrive,
  DriveFileItem,
} from "../utils/googleDriveAuth";

interface DriveGithubModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeSession: ChatSession;
  onAttachFiles: (attachments: ChatAttachment[]) => void;
}

interface GithubTreeItem {
  path: string;
  type: "blob" | "tree";
  size?: number;
  sha: string;
}

export const DriveGithubModal: React.FC<DriveGithubModalProps> = ({
  isOpen,
  onClose,
  activeSession,
  onAttachFiles,
}) => {
  const [activeTab, setActiveTab] = useState<"drive" | "github">("drive");

  // Google Drive State
  const [needsAuth, setNeedsAuth] = useState(true);
  const [driveUser, setDriveUser] = useState<User | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [driveFiles, setDriveFiles] = useState<DriveFileItem[]>([]);
  const [driveSearch, setDriveSearch] = useState("");
  const [driveLoading, setDriveLoading] = useState(false);
  const [importingFileId, setImportingFileId] = useState<string | null>(null);
  const [driveError, setDriveError] = useState<string | null>(null);
  const [driveNotice, setDriveNotice] = useState<string | null>(null);

  // Explicit Confirmation State before saving/creating a file in Google Drive
  const [confirmSaveOpen, setConfirmSaveOpen] = useState(false);
  const [saveFileName, setSaveFileName] = useState("");
  const [savingToDrive, setSavingToDrive] = useState(false);

  // GitHub State
  const [repoInput, setRepoInput] = useState("");
  const [githubToken, setGithubToken] = useState("");
  const [githubConnectedUser, setGithubConnectedUser] = useState<string | null>(
    null
  );
  const [repoInfo, setRepoInfo] = useState<{
    owner: string;
    repo: string;
    branch: string;
    description: string;
  } | null>(null);
  const [repoFiles, setRepoFiles] = useState<GithubTreeItem[]>([]);
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [githubFileFilter, setGithubFileFilter] = useState("");
  const [githubLoading, setGithubLoading] = useState(false);
  const [githubImporting, setGithubImporting] = useState(false);
  const [githubError, setGithubError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = initAuth(
      (u) => {
        setDriveUser(u);
        setNeedsAuth(false);
      },
      () => {
        setDriveUser(null);
        setNeedsAuth(true);
      }
    );
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (isOpen && !needsAuth && activeTab === "drive") {
      loadDriveFiles(driveSearch);
    }
  }, [isOpen, needsAuth, activeTab]);

  // Listen for GitHub OAuth Popup success message
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const origin = event.origin;
      if (!origin.endsWith(".run.app") && !origin.includes("localhost")) {
        return;
      }
      if (event.data?.type === "OAUTH_AUTH_SUCCESS") {
        if (event.data.token) {
          setGithubToken(event.data.token);
        }
        if (event.data.username) {
          setGithubConnectedUser(event.data.username);
        }
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  if (!isOpen) return null;

  const loadDriveFiles = async (query = "") => {
    setDriveLoading(true);
    setDriveError(null);
    try {
      const files = await listGoogleDriveFiles(query);
      setDriveFiles(files);
    } catch (err: unknown) {
      if (err instanceof Error && err.message === "UNAUTHENTICATED") {
        setNeedsAuth(true);
      } else {
        setDriveError(
          err instanceof Error ? err.message : "Failed to load Google Drive files"
        );
      }
    } finally {
      setDriveLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setIsLoggingIn(true);
    setDriveError(null);
    try {
      const result = await googleSignIn();
      if (result) {
        setDriveUser(result.user);
        setNeedsAuth(false);
        await loadDriveFiles(driveSearch);
      }
    } catch (err: unknown) {
      setDriveError(
        err instanceof Error ? err.message : "Google Sign-In failed"
      );
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleGoogleLogout = async () => {
    await logoutGoogleDrive();
    setDriveUser(null);
    setNeedsAuth(true);
    setDriveFiles([]);
  };

  const handleImportDriveFile = async (file: DriveFileItem) => {
    setImportingFileId(file.id);
    setDriveError(null);
    setDriveNotice(null);
    try {
      const attachment = await importDriveFileAsAttachment(file);
      onAttachFiles([attachment]);
      setDriveNotice(`"${file.name}" চ্যাটে যুক্ত করা হয়েছে!`);
    } catch (err: unknown) {
      if (err instanceof Error && err.message === "UNAUTHENTICATED") {
        setNeedsAuth(true);
      } else {
        setDriveError(
          err instanceof Error ? err.message : "Failed to import file from Drive"
        );
      }
    } finally {
      setImportingFileId(null);
    }
  };

  const openSaveConfirmation = () => {
    const defaultName = `${activeSession.title || "notrack_chat"}_${new Date()
      .toISOString()
      .slice(0, 10)}.md`;
    setSaveFileName(defaultName);
    setConfirmSaveOpen(true);
  };

  const handleConfirmedSaveToDrive = async () => {
    setSavingToDrive(true);
    setDriveError(null);
    setDriveNotice(null);
    try {
      const created = await saveChatTranscriptToDrive(
        activeSession,
        saveFileName.trim() || "notrack_chat.md"
      );
      setConfirmSaveOpen(false);
      setDriveNotice(`Google Drive-এ "${created.name}" নামে সেভ হয়েছে!`);
      await loadDriveFiles(driveSearch);
    } catch (err: unknown) {
      setDriveError(
        err instanceof Error ? err.message : "Failed to save to Google Drive"
      );
    } finally {
      setSavingToDrive(false);
    }
  };

  // GitHub OAuth Popup Connect
  const handleConnectGithubOAuth = async () => {
    setGithubError(null);
    try {
      const redirectUri = `${window.location.origin}/auth/github/callback`;
      const res = await fetch(
        `/api/auth/github/url?redirect_uri=${encodeURIComponent(redirectUri)}`
      );
      const data = await res.json();
      if (!res.ok || !data.url) {
        throw new Error(
          data.error ||
            "GitHub OAuth Client ID সেট করা নেই। আপনি সরাসরি নিচে যেকোনো GitHub Repo URL বা ফাইল লিংক পেস্ট করে ইমপোর্ট করতে পারবেন!"
        );
      }
      window.open(data.url, "github_oauth_popup", "width=600,height=700");
    } catch (err: unknown) {
      setGithubError(
        err instanceof Error ? err.message : "Could not start GitHub OAuth"
      );
    }
  };

  const handleFetchGithubRepo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!repoInput.trim()) return;
    setGithubLoading(true);
    setGithubError(null);
    setRepoFiles([]);
    setSelectedPaths([]);

    try {
      const res = await fetch("/api/github/inspect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repoUrl: repoInput.trim(),
          token: githubToken.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to load GitHub repository");
      }

      // If it was a direct single-file URL, attach it immediately
      if (data.singleFile) {
        onAttachFiles([
          {
            id: `gh-${Date.now()}`,
            name: data.singleFile.name,
            mimeType: "text/plain",
            size: data.singleFile.content.length,
            textContent: data.singleFile.content,
          },
        ]);
        onClose();
        return;
      }

      setRepoInfo({
        owner: data.owner,
        repo: data.repo,
        branch: data.branch,
        description: data.description || "",
      });
      setRepoFiles(data.files || []);
    } catch (err: unknown) {
      setGithubError(
        err instanceof Error ? err.message : "GitHub repo fetch failed"
      );
    } finally {
      setGithubLoading(false);
    }
  };

  const toggleSelectGithubPath = (path: string) => {
    setSelectedPaths((prev) =>
      prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path]
    );
  };

  const handleImportSelectedGithubFiles = async () => {
    if (!repoInfo || selectedPaths.length === 0) return;
    setGithubImporting(true);
    setGithubError(null);
    try {
      const res = await fetch("/api/github/fetch-files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner: repoInfo.owner,
          repo: repoInfo.repo,
          branch: repoInfo.branch,
          paths: selectedPaths.slice(0, 15),
          token: githubToken.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to fetch GitHub files");
      }

      const attachments: ChatAttachment[] = (data.files || []).map(
        (f: { path: string; content: string }) => ({
          id: `gh-${f.path}-${Date.now()}`,
          name: `${repoInfo.repo}/${f.path}`,
          mimeType: "text/plain",
          size: f.content.length,
          textContent: f.content,
        })
      );

      onAttachFiles(attachments);
      onClose();
    } catch (err: unknown) {
      setGithubError(
        err instanceof Error ? err.message : "Failed to import GitHub files"
      );
    } finally {
      setGithubImporting(false);
    }
  };

  const filteredRepoFiles = repoFiles.filter((f) =>
    githubFileFilter.trim()
      ? f.path.toLowerCase().includes(githubFileFilter.trim().toLowerCase())
      : true
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4">
      <div className="w-full max-w-3xl rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden flex flex-col max-h-[88vh]">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setActiveTab("drive")}
              className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                activeTab === "drive"
                  ? "bg-emerald-600 text-white"
                  : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300"
              }`}
            >
              <HardDrive className="w-3.5 h-3.5" />
              <span>Google Drive</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("github")}
              className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                activeTab === "github"
                  ? "bg-emerald-600 text-white"
                  : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300"
              }`}
            >
              <FolderGit2 className="w-3.5 h-3.5" />
              <span>GitHub Repo / Code</span>
            </button>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {activeTab === "drive" ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-display font-bold text-slate-900 dark:text-white">
                    Google Drive Integration
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Google Drive থেকে ডকুমেন্ট, কোড, PDF বা ছবি সরাসরি চ্যাটে ইমপোর্ট করুন অথবা বর্তমান চ্যাট Drive-এ সেভ করুন।
                  </p>
                </div>

                {!needsAuth && driveUser && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-600 dark:text-slate-300 font-mono">
                      {driveUser.email}
                    </span>
                    <button
                      type="button"
                      onClick={handleGoogleLogout}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                    >
                      <LogOut className="w-3 h-3" />
                      <span>Sign out</span>
                    </button>
                  </div>
                )}
              </div>

              {driveError && (
                <div className="p-3 rounded-lg border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 text-xs text-rose-700 dark:text-rose-300">
                  {driveError}
                </div>
              )}

              {driveNotice && (
                <div className="p-3 rounded-lg border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-xs text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
                  <Check className="w-4 h-4 shrink-0" />
                  <span>{driveNotice}</span>
                </div>
              )}

              {needsAuth ? (
                <div className="py-10 flex flex-col items-center justify-center text-center space-y-4 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
                  <HardDrive className="w-10 h-10 text-emerald-600 dark:text-emerald-400" />
                  <div className="space-y-1 max-w-md">
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">
                      Connect Your Google Drive Account
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Sign in with Google to browse your Drive files, import Docs/Sheets/images into the chat, or save chat transcripts to your Drive.
                    </p>
                  </div>

                  {/* Official Sign in with Google button */}
                  <button
                    type="button"
                    onClick={handleGoogleLogin}
                    disabled={isLoggingIn}
                    className="gsi-material-button inline-flex items-center gap-3 px-5 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-800 dark:text-white text-sm font-medium shadow-xs transition-all cursor-pointer"
                  >
                    <div className="gsi-material-button-state" />
                    <div className="gsi-material-button-content-wrapper flex items-center gap-2.5">
                      <div className="gsi-material-button-icon w-5 h-5">
                        <svg
                          version="1.1"
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 48 48"
                          className="w-5 h-5 block"
                        >
                          <path
                            fill="#EA4335"
                            d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                          />
                          <path
                            fill="#4285F4"
                            d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                          />
                          <path
                            fill="#FBBC05"
                            d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                          />
                          <path
                            fill="#34A853"
                            d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                          />
                          <path fill="none" d="M0 0h48v48H0z" />
                        </svg>
                      </div>
                      <span className="gsi-material-button-contents">
                        {isLoggingIn ? "Signing in..." : "Sign in with Google"}
                      </span>
                    </div>
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Search & Save bar */}
                  <div className="flex flex-wrap items-center gap-2">
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        loadDriveFiles(driveSearch);
                      }}
                      className="flex-1 flex items-center gap-2"
                    >
                      <div className="relative flex-1">
                        <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                          type="text"
                          value={driveSearch}
                          onChange={(e) => setDriveSearch(e.target.value)}
                          placeholder="Google Drive ফাইল খুঁজুন..."
                          className="w-full pl-8 pr-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={driveLoading}
                        className="px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 cursor-pointer"
                      >
                        Search
                      </button>
                      <button
                        type="button"
                        onClick={() => loadDriveFiles(driveSearch)}
                        className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-slate-800 dark:hover:text-white cursor-pointer"
                        title="Refresh Drive files"
                      >
                        <RefreshCw
                          className={`w-3.5 h-3.5 ${
                            driveLoading ? "animate-spin" : ""
                          }`}
                        />
                      </button>
                    </form>

                    <button
                      type="button"
                      onClick={openSaveConfirmation}
                      disabled={activeSession.messages.length === 0}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-semibold cursor-pointer"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      <span>Save Chat to Drive</span>
                    </button>
                  </div>

                  {/* Mandatory Confirmation Dialog for Mutating Drive Operation */}
                  {confirmSaveOpen && (
                    <div className="p-4 rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50/90 dark:bg-amber-950/40 space-y-3">
                      <p className="text-xs font-semibold text-amber-900 dark:text-amber-200">
                        Confirm Saving File to Google Drive
                      </p>
                      <p className="text-xs text-amber-800 dark:text-amber-300">
                        আপনি কি বর্তমান চ্যাট ট্রান্সক্রিপ্টটি ({activeSession.messages.length} টি মেসেজ) আপনার Google Drive-এ নতুন ফাইল হিসেবে সেভ করতে চান?
                      </p>
                      <input
                        type="text"
                        value={saveFileName}
                        onChange={(e) => setSaveFileName(e.target.value)}
                        className="w-full px-3 py-1.5 rounded border border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-900 text-xs font-mono text-slate-900 dark:text-white"
                      />
                      <div className="flex items-center gap-2 justify-end">
                        <button
                          type="button"
                          onClick={() => setConfirmSaveOpen(false)}
                          className="px-3 py-1.5 rounded border border-slate-300 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-300 cursor-pointer"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={handleConfirmedSaveToDrive}
                          disabled={savingToDrive}
                          className="px-3.5 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold cursor-pointer"
                        >
                          {savingToDrive ? "Saving..." : "Confirm & Save to Drive"}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Files List */}
                  <div className="border border-slate-200 dark:border-slate-800 rounded-xl divide-y divide-slate-200 dark:divide-slate-800 max-h-80 overflow-y-auto">
                    {driveLoading ? (
                      <div className="p-8 text-center text-xs text-slate-500">
                        Loading your Google Drive files...
                      </div>
                    ) : driveFiles.length === 0 ? (
                      <div className="p-8 text-center text-xs text-slate-500">
                        No matching files found in your Google Drive.
                      </div>
                    ) : (
                      driveFiles.map((file) => (
                        <div
                          key={file.id}
                          className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            {file.mimeType.startsWith("image/") ? (
                              <ImageIcon className="w-4 h-4 text-emerald-500 shrink-0" />
                            ) : (
                              <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                            )}
                            <div className="min-w-0">
                              <p className="text-xs font-medium text-slate-900 dark:text-white truncate">
                                {file.name}
                              </p>
                              <p className="text-[11px] text-slate-500 truncate">
                                {file.mimeType.replace(
                                  "application/vnd.google-apps.",
                                  "Google "
                                )}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            {file.webViewLink && (
                              <a
                                href={file.webViewLink}
                                target="_blank"
                                rel="noreferrer"
                                className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                                title="Open in Google Drive"
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                              </a>
                            )}
                            <button
                              type="button"
                              onClick={() => handleImportDriveFile(file)}
                              disabled={importingFileId === file.id}
                              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-emerald-600/10 hover:bg-emerald-600 text-emerald-700 dark:text-emerald-300 hover:text-white text-xs font-medium transition-colors cursor-pointer"
                            >
                              <Download className="w-3 h-3" />
                              <span>
                                {importingFileId === file.id
                                  ? "Importing..."
                                  : "Import to Chat"}
                              </span>
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </>
          ) : (
            /* GitHub Tab */
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-display font-bold text-slate-900 dark:text-white">
                    GitHub Repository & Code Importer
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    যেকোনো GitHub Repo URL (`owner/repo`) বা ফাইলের লিংক দিন—সরাসরি ফাইল সিলেক্ট করে চ্যাটে (`Carbon 4`, `Argon 4`, `NoTrack`) ইমপোর্ট করুন।
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleConnectGithubOAuth}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 text-xs font-medium text-slate-800 dark:text-slate-200 cursor-pointer"
                >
                  <FolderGit2 className="w-3.5 h-3.5 text-emerald-500" />
                  <span>
                    {githubConnectedUser
                      ? `Connected: @${githubConnectedUser}`
                      : "Connect GitHub OAuth"}
                  </span>
                </button>
              </div>

              {githubError && (
                <div className="p-3 rounded-lg border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 text-xs text-rose-700 dark:text-rose-300">
                  {githubError}
                </div>
              )}

              <form onSubmit={handleFetchGithubRepo} className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <input
                    type="text"
                    value={repoInput}
                    onChange={(e) => setRepoInput(e.target.value)}
                    placeholder="e.g. facebook/react or https://github.com/owner/repo"
                    className="sm:col-span-2 px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-mono text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                  />
                  <input
                    type="password"
                    value={githubToken}
                    onChange={(e) => setGithubToken(e.target.value)}
                    placeholder="Optional PAT (for Private Repos)"
                    className="px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-mono text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <button
                  type="submit"
                  disabled={githubLoading || !repoInput.trim()}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-semibold cursor-pointer"
                >
                  <Code2 className="w-3.5 h-3.5" />
                  <span>
                    {githubLoading ? "Loading Repository..." : "Load GitHub Repo / File"}
                  </span>
                </button>
              </form>

              {repoInfo && (
                <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-800">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-xs font-mono font-bold text-emerald-600 dark:text-emerald-400">
                        {repoInfo.owner}/{repoInfo.repo} ({repoInfo.branch})
                      </p>
                      {repoInfo.description && (
                        <p className="text-xs text-slate-500 truncate max-w-lg">
                          {repoInfo.description}
                        </p>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={handleImportSelectedGithubFiles}
                      disabled={selectedPaths.length === 0 || githubImporting}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-semibold cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>
                        {githubImporting
                          ? "Importing..."
                          : `Import Selected (${selectedPaths.length}) to Chat`}
                      </span>
                    </button>
                  </div>

                  <input
                    type="text"
                    value={githubFileFilter}
                    onChange={(e) => setGithubFileFilter(e.target.value)}
                    placeholder="Filter repository files (e.g. src/ or .tsx)..."
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-mono"
                  />

                  <div className="border border-slate-200 dark:border-slate-800 rounded-xl divide-y divide-slate-200 dark:divide-slate-800 max-h-64 overflow-y-auto">
                    {filteredRepoFiles.slice(0, 120).map((item) => {
                      const checked = selectedPaths.includes(item.path);
                      return (
                        <label
                          key={item.path}
                          className="flex items-center justify-between gap-3 px-3.5 py-2 hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer text-xs font-mono"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleSelectGithubPath(item.path)}
                              className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                            />
                            <span className="truncate text-slate-800 dark:text-slate-200">
                              {item.path}
                            </span>
                          </div>
                          {item.size !== undefined && (
                            <span className="text-[11px] text-slate-400 shrink-0">
                              {(item.size / 1024).toFixed(1)} KB
                            </span>
                          )}
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
