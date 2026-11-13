import React, { useState } from "react";
import {
  X,
  Download,
  RefreshCw,
  Code2,
  Eye,
  Maximize2,
  Minimize2,
} from "lucide-react";

interface LiveSandboxPanelProps {
  htmlCode: string;
  onClose: () => void;
  onUpdateCode: (newCode: string) => void;
}

export const LiveSandboxPanel: React.FC<LiveSandboxPanelProps> = ({
  htmlCode,
  onClose,
  onUpdateCode,
}) => {
  const [activeTab, setActiveTab] = useState<"preview" | "source">("preview");
  const [iframeKey, setIframeKey] = useState(0);
  const [isExpanded, setIsExpanded] = useState(false);

  const handleDownloadHtml = () => {
    const blob = new Blob([htmlCode], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `notrack_sandbox_${Date.now()}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <aside
      className={`${
        isExpanded
          ? "fixed inset-4 z-50 rounded-xl shadow-2xl"
          : "w-full lg:w-[46%] xl:w-[48%] border-l"
      } flex flex-col bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 h-full overflow-hidden`}
    >
      <div className="flex items-center justify-between gap-4 px-4 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
        <div className="flex items-center gap-3 min-w-0">
          <span className="font-display font-semibold text-sm text-slate-900 dark:text-slate-100 whitespace-nowrap shrink-0">
            Live HTML Sandbox
          </span>
          <span className="text-xs text-slate-400" aria-hidden="true">
            ·
          </span>
          <div className="flex items-center gap-1 p-0.5 bg-slate-200/70 dark:bg-slate-800 rounded-md">
            <button
              type="button"
              onClick={() => setActiveTab("preview")}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === "preview"
                  ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
              }`}
            >
              <Eye className="w-3.5 h-3.5" />
              <span>Preview</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("source")}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === "source"
                  ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
              }`}
            >
              <Code2 className="w-3.5 h-3.5" />
              <span>Editable Source</span>
            </button>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => setIframeKey((k) => k + 1)}
            className="p-1.5 rounded-lg text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            title="Reload preview"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={handleDownloadHtml}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download .HTML</span>
          </button>
          <button
            type="button"
            onClick={() => setIsExpanded((e) => !e)}
            className="p-1.5 rounded-lg text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            title={isExpanded ? "Dock panel" : "Expand panel"}
          >
            {isExpanded ? (
              <Minimize2 className="w-4 h-4" />
            ) : (
              <Maximize2 className="w-4 h-4" />
            )}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            title="Close sandbox"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 relative bg-white dark:bg-slate-950 overflow-hidden">
        {activeTab === "preview" ? (
          <iframe
            key={iframeKey}
            title="NoTrack Live HTML Preview"
            srcDoc={htmlCode}
            sandbox="allow-scripts allow-forms allow-modals"
            className="w-full h-full border-0 bg-white"
          />
        ) : (
          <textarea
            value={htmlCode}
            onChange={(e) => onUpdateCode(e.target.value)}
            spellCheck={false}
            className="w-full h-full p-4 font-mono text-xs leading-relaxed bg-slate-950 text-slate-100 focus:outline-none resize-none"
          />
        )}
      </div>
    </aside>
  );
};
