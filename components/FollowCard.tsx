"use client";

import { brand } from "@/lib/config";

export function FollowCard({ onDismiss, title }: { onDismiss: () => void; title?: string }) {
  return (
    <aside
      aria-label="Follow on Instagram"
      className="pop-in flex flex-col gap-3 rounded-2xl border-2 border-accent bg-panel p-4"
    >
      <p className="display text-2xl">{title ?? `Follow @${brand.igHandle} for results`}</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <a
          href={brand.igUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-primary flex-1"
        >
          Follow on Instagram
        </a>
        <button type="button" onClick={onDismiss} className="btn btn-ghost">
          Not now
        </button>
      </div>
    </aside>
  );
}
