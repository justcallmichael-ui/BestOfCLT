"use client";

import { useState } from "react";
import { copyText } from "./CopyButton";

/** Public page button: Web Share API with the page URL, falls back to copying the link. */
export function SharePageButton({ url, title, className = "btn btn-ghost" }: { url?: string; title: string; className?: string }) {
  const [msg, setMsg] = useState<string | null>(null);
  async function onClick() {
    const target = url ?? window.location.href;
    setMsg(null);
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title, url: target });
        return;
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
    }
    setMsg((await copyText(target)) ? "Link copied" : "Could not copy the link");
  }
  return (
    <span className="inline-flex flex-col gap-1">
      <button type="button" onClick={onClick} className={className}>
        Share this page
      </button>
      <span aria-live="polite" className="min-h-5 text-sm text-muted">
        {msg}
      </span>
    </span>
  );
}
