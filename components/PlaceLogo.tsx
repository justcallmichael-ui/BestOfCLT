"use client";

import { useState } from "react";

/**
 * A place's Instagram profile picture, kept on our own server.
 * Until it exists, or if Instagram would not give it up, a letter circle shows instead.
 */
export function PlaceLogo({ handle, name, size = 40 }: { handle: string; name: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const letter = (name.trim()[0] ?? handle[0] ?? "?").toUpperCase();
  const box = { width: size, height: size };
  if (failed) {
    return (
      <span
        aria-hidden="true"
        style={{ ...box, fontSize: Math.round(size * 0.5) }}
        className="display inline-flex shrink-0 items-center justify-center rounded-full border border-line bg-panel-2 text-muted"
      >
        {letter}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/api/logo/${encodeURIComponent(handle)}`}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      style={box}
      className="shrink-0 rounded-full border border-line bg-panel-2 object-cover"
    />
  );
}
