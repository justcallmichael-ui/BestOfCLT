"use client";

import { useState, useSyncExternalStore } from "react";

/** True when this browser can share image files through the system share sheet. */
function detectFileShare(): boolean {
  try {
    if (typeof navigator === "undefined" || typeof navigator.share !== "function" || typeof navigator.canShare !== "function") {
      return false;
    }
    return navigator.canShare({ files: [new File([""], "x.png", { type: "image/png" })] });
  } catch {
    return false;
  }
}

const subscribeNone = () => () => undefined;

/** A graphic preview with Share (system share sheet, hidden when unsupported) and Download. */
export function ImageCard({
  src,
  fileName,
  label,
  ratio,
  priority = false,
}: {
  src: string;
  fileName: string;
  label: string;
  /** width / height, for example 9 / 16 */
  ratio: number;
  priority?: boolean;
}) {
  const supported = useSyncExternalStore(subscribeNone, detectFileShare, () => false);
  const [failed, setFailed] = useState(false);
  const canShare = supported && !failed;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function share() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(src, { cache: "no-store" });
      if (!res.ok) throw new Error("image");
      const blob = await res.blob();
      const file = new File([blob], fileName, { type: "image/png" });
      if (!navigator.canShare({ files: [file] })) {
        setFailed(true);
        setError("Sharing is not available here. Use Download.");
        return;
      }
      await navigator.share({ files: [file] });
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) setError("Could not share. Try Download.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="text-sm font-semibold">{label}</figcaption>
      <div className="overflow-hidden rounded-lg border border-neutral-300 bg-neutral-200" style={{ aspectRatio: String(ratio) }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={label}
          loading={priority ? "eager" : "lazy"}
          className="h-full w-full object-cover"
        />
      </div>
      <div className="flex gap-2">
        {canShare && (
          <button
            type="button"
            onClick={share}
            disabled={busy}
            className="min-h-11 flex-1 rounded-lg bg-neutral-900 px-3 font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Opening..." : "Share"}
          </button>
        )}
        <a
          href={src}
          download={fileName}
          className="flex min-h-11 flex-1 items-center justify-center rounded-lg border border-neutral-300 bg-white px-3 font-semibold text-neutral-900"
        >
          Download
        </a>
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}
    </figure>
  );
}
