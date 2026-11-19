"use client";

import { useState } from "react";
import { copyText } from "./CopyButton";

/**
 * Owner button. On a phone it opens the share sheet with the story graphic, so Instagram
 * (Story) is one tap. On a computer it saves the graphic to add to a story from the phone.
 */
export function StoryButton({ entrantId, handle, url, title, label = "Add to your Instagram story", compact = false }: { entrantId: string; handle: string; url: string; title: string; label?: string; compact?: boolean }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onClick() {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    const link = new URL(url, window.location.origin).toString();
    // Copy first, while the tap still counts. Instagram needs the link added by hand as a sticker.
    let copied = false;
    try {
      await navigator.clipboard.writeText(link);
      copied = true;
    } catch {
      copied = false;
    }
    const steps = copied
      ? "Link copied. In your story tap the sticker button, pick Link, paste it, and set the text to Vote for us."
      : "In your story tap the sticker button, pick Link, and add this page's link.";
    setMsg(steps);
    try {
      const res = await fetch(`/api/og/entrant?id=${encodeURIComponent(entrantId)}`);
      if (!res.ok) throw new Error("graphic");
      const blob = await res.blob();
      const file = new File([blob], `vote-for-${handle}.png`, { type: "image/png" });
      if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title, url: link });
          setMsg(steps);
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
      setMsg(`Saved. Open Instagram, start a story and add this picture. ${steps}`);
    } catch {
      setMsg("Could not make the graphic. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    const ok = await copyText(new URL(url, window.location.origin).toString());
    setMsg(
      ok
        ? "Link copied. Now open your story, tap the sticker button, pick Link, paste it, and set the text to Vote for us."
        : "Could not copy the link. Press and hold the page address to copy it.",
    );
  }

  if (compact) {
    return (
      <span className="flex flex-col items-center gap-1">
        <button
          type="button"
          onClick={onClick}
          disabled={busy}
          className="inline-flex min-h-9 items-center px-2 text-sm font-bold text-black underline underline-offset-4"
        >
          {busy ? "Getting it ready..." : label}
        </button>
        {msg ? <span aria-live="polite" className="text-center text-xs text-black">{msg}</span> : null}
      </span>
    );
  }

  return (
    <span className="inline-flex flex-col gap-2">
      <span className="flex flex-wrap gap-2">
        <button type="button" onClick={onClick} disabled={busy} className="btn btn-primary">
          {busy ? "Getting it ready..." : label}
        </button>
        <button type="button" onClick={() => void copyLink()} className="btn btn-ghost">
          Copy link
        </button>
      </span>
      <span aria-live="polite" className="max-w-xs text-sm text-muted">
        {msg ?? "Tap Copy link, then in your story tap the sticker button, pick Link, paste it, and set the text to Vote for us."}
      </span>
    </span>
  );
}
