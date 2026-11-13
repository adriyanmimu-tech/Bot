import { initializeApp, getApps, getApp } from "firebase/app";
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  User,
} from "firebase/auth";
import firebaseConfig from "../../firebase-applet-config.json";
import { ChatAttachment, ChatSession } from "../types";

export const SCOPES = [
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/drive.file",
];

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
const auth = getAuth(app);

const provider = new GoogleAuthProvider();
for (const scope of SCOPES) {
  provider.addScope(scope);
}

// Flag to indicate if we are in the middle of a sign-in flow.
let isSigningIn = false;
// Cache the access token in memory ONLY (never in localStorage or sessionStorage).
let cachedAccessToken: string | null = null;

export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      if (cachedAccessToken) {
        if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
      } else if (!isSigningIn) {
        cachedAccessToken = null;
        if (onAuthFailure) onAuthFailure();
      }
    } else {
      cachedAccessToken = null;
      if (onAuthFailure) onAuthFailure();
    }
  });
};

export const googleSignIn = async (): Promise<{
  user: User;
  accessToken: string;
} | null> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error("Failed to get access token from Firebase Auth");
    }

    cachedAccessToken = credential.accessToken;
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error: unknown) {
    console.error("Sign in error:", error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

export const getAccessToken = async (): Promise<string | null> => {
  return cachedAccessToken;
};

export const logoutGoogleDrive = async () => {
  await auth.signOut();
  cachedAccessToken = null;
};

export interface DriveFileItem {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  iconLink?: string;
  webViewLink?: string;
}

export async function listGoogleDriveFiles(
  searchQuery = ""
): Promise<DriveFileItem[]> {
  const token = await getAccessToken();
  if (!token) {
    throw new Error("UNAUTHENTICATED");
  }

  const qParts = ["trashed = false", "mimeType != 'application/vnd.google-apps.folder'"];
  if (searchQuery.trim()) {
    const safe = searchQuery.trim().replace(/'/g, "\\'");
    qParts.push(`name contains '${safe}'`);
  }

  const params = new URLSearchParams({
    pageSize: "25",
    fields:
      "files(id,name,mimeType,size,modifiedTime,iconLink,webViewLink)",
    orderBy: "modifiedTime desc",
    q: qParts.join(" and "),
  });

  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  if (res.status === 401 || res.status === 403) {
    cachedAccessToken = null;
    throw new Error("UNAUTHENTICATED");
  }

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(
      errData?.error?.message || `Google Drive API Error (${res.status})`
    );
  }

  const data = await res.json();
  return Array.isArray(data.files) ? data.files : [];
}

export async function importDriveFileAsAttachment(
  file: DriveFileItem
): Promise<ChatAttachment> {
  const token = await getAccessToken();
  if (!token) {
    throw new Error("UNAUTHENTICATED");
  }

  // Handle Google Docs / Sheets / Slides export
  if (file.mimeType === "application/vnd.google-apps.document") {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=text/plain`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) throw new Error("Failed to export Google Doc");
    const textContent = await res.text();
    return {
      id: `drive-${file.id}-${Date.now()}`,
      name: `${file.name}.txt`,
      mimeType: "text/plain",
      size: textContent.length,
      textContent: textContent.slice(0, 150000),
    };
  }

  if (file.mimeType === "application/vnd.google-apps.spreadsheet") {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=text/csv`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) throw new Error("Failed to export Google Sheet");
    const textContent = await res.text();
    return {
      id: `drive-${file.id}-${Date.now()}`,
      name: `${file.name}.csv`,
      mimeType: "text/csv",
      size: textContent.length,
      textContent: textContent.slice(0, 150000),
    };
  }

  if (file.mimeType === "application/vnd.google-apps.presentation") {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=text/plain`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) throw new Error("Failed to export Google Slides");
    const textContent = await res.text();
    return {
      id: `drive-${file.id}-${Date.now()}`,
      name: `${file.name}.txt`,
      mimeType: "text/plain",
      size: textContent.length,
      textContent: textContent.slice(0, 150000),
    };
  }

  // Download binary or plain text file
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) {
    throw new Error(`Failed to download file (${res.status})`);
  }

  if (file.mimeType.startsWith("image/")) {
    const blob = await res.blob();
    const base64Url = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(String(reader.result || ""));
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    const base64Data = base64Url.includes(",")
      ? base64Url.split(",")[1]
      : base64Url;

    return {
      id: `drive-${file.id}-${Date.now()}`,
      name: file.name,
      mimeType: file.mimeType,
      size: blob.size,
      data: base64Data,
      previewUrl: base64Url,
    };
  }

  // Treat as text / code / markdown / JSON
  const textContent = await res.text();
  return {
    id: `drive-${file.id}-${Date.now()}`,
    name: file.name,
    mimeType: file.mimeType || "text/plain",
    size: textContent.length,
    textContent: textContent.slice(0, 150000),
  };
}

export async function saveChatTranscriptToDrive(
  session: ChatSession,
  customFileName: string
): Promise<{ id: string; name: string; webViewLink?: string }> {
  const token = await getAccessToken();
  if (!token) {
    throw new Error("UNAUTHENTICATED");
  }

  const lines: string[] = [
    `# ${session.title}`,
    `Saved from notrack.ai Pro · ${new Date().toLocaleString()}`,
    `Model Engine: ${session.modelEngine}`,
    "",
    "---",
    "",
  ];

  for (const msg of session.messages) {
    const who = msg.role === "user" ? "### You" : "### AI";
    lines.push(who);
    lines.push("");
    lines.push(msg.content);
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  const markdownBody = lines.join("\n");
  const metadata = {
    name: customFileName.endsWith(".md")
      ? customFileName
      : `${customFileName}.md`,
    mimeType: "text/markdown",
  };

  const boundary = "-------notrack_drive_boundary_" + Date.now();
  const multipartBody =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: text/markdown; charset=UTF-8\r\n\r\n` +
    `${markdownBody}\r\n` +
    `--${boundary}--`;

  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body: multipartBody,
    }
  );

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(
      errData?.error?.message || `Failed to save to Google Drive (${res.status})`
    );
  }

  return await res.json();
}
