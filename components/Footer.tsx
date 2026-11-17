"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { brand } from "@/lib/config";

export function Footer() {
  // The footer lives in the root layout, so read the tournament slug from the URL.
  const slug = /^\/t\/([^/]+)/.exec(usePathname() ?? "")?.[1];
  return (
    <footer className="mt-10 border-t-2 border-line pb-28 pt-6 md:pb-8">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 px-4 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
        <p>
          {brand.name}, presented by {brand.presentedBy}
        </p>
        {slug ? (
          <Link
            href={`/t/${slug}/how-it-works`}
            className="inline-flex min-h-12 items-center font-semibold text-chalk underline decoration-accent decoration-2 underline-offset-4"
          >
            How it works
          </Link>
        ) : null}
        <a
          href={brand.igUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-12 items-center font-semibold text-chalk underline decoration-accent decoration-2 underline-offset-4"
        >
          @{brand.igHandle} on Instagram
        </a>
      </div>
    </footer>
  );
}
