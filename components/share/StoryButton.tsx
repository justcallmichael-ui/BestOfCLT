"use client";

import { useState } from "react";

/**
 * Owner button. On a phone it opens the share sheet with the story graphic, so Instagram
 * (Story) is one tap. On a computer it saves the graphic to add to a story from the phone.
 */
export function StoryButton({ entrantId, handle, url, title, label = "Add to your Instagram story" }: { entrantId: string; handle: string; url: string; title: string; label?: string }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onClick() {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/og/entrant?id=${encodeURIComponent(entrantId)}`);
      if (!res.ok) throw new Error("graphic");
      const blob = await res.blob();
      const file = new File([blob], `vote-for-${handle}.png`, { type: "image/png" });
      if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title, url: new URL(url, window.location.origin).toString() });
          return;
        } catch (e) {
          if (e instanceof DOMException && e.name === "AbortError") return;
        }
      }
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setMsg("Saved. Open Instagram, start a story and add this picture.");
    } catch {
      setMsg("Could not make the graphic. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col gap-1">
      <button type="button" onClick={onClick} disabled={busy} className="btn btn-primary">
        {busy ? "Getting it ready..." : label}
      </button>
      <span aria-live="polite" className="min-h-5 text-sm text-muted">
        {msg}
      </span>
    </span>
  );
}
