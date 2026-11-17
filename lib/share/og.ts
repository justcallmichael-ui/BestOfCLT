import { ImageResponse } from "next/og";
import type { ReactElement } from "react";

export const OG_CACHE = "public, s-maxage=600";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (v: string | null): v is string => !!v && UUID.test(v);

/** Valid date strings become a canonical ISO string, anything else null. */
export function parseIsoParam(v: string | null): string | null {
  if (!v || v.length > 40) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

export function badRequest(message: string): Response {
  return Response.json({ error: message }, { status: 400 });
}

export function notFoundJson(message = "Not found"): Response {
  return Response.json({ error: message }, { status: 404 });
}

export function png(element: ReactElement, width: number, height: number): ImageResponse {
  return new ImageResponse(element, { width, height, headers: { "Cache-Control": OG_CACHE } });
}
