"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * During nominations a shared place link sends people to the list, scrolled to that place,
 * so they can vote and keep browsing. Crawlers do not run this, so link previews still show the place.
 */
export function GoToList({ slug, handle }: { slug: string; handle: string }) {
  const router = useRouter();
  useEffect(() => {
    router.replace(`/t/${encodeURIComponent(slug)}#place-${encodeURIComponent(handle)}`);
  }, [router, slug, handle]);
  return null;
}
