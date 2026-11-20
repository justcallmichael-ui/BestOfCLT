import Link from "next/link";
import { TournamentHome } from "@/components/TournamentHome";
import { TournamentNav } from "@/components/TournamentNav";
import { getDb } from "@/lib/db";
import { brand } from "@/lib/config";

export const dynamic = "force-dynamic";

async function newest(): Promise<{ slug: string; status: string } | null> {
  try {
    const rows = await getDb().query<{ slug: string; status: string }>(
      "select slug, status from tournaments where status <> 'draft' order by created_at desc limit 1",
    );
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

export default async function Home() {
  const t = await newest();
  if (t) {
    // Show the live tournament right here so the address stays bestofclt.com.
    return (
      <>
        <TournamentNav slug={t.slug} initialStatus={t.status} />
        <TournamentHome slug={t.slug} />
      </>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col items-start gap-5 px-4 py-16">
      <p className="display text-lg text-accent">Coming soon</p>
      <h1 className="display text-5xl">No tournament is live yet</h1>
      <p className="text-lg text-muted">
        The bracket is being built. Follow @{brand.igHandle} on Instagram and you will see it first.
      </p>
      <a
        href={brand.igUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="btn btn-primary"
      >
        Follow @{brand.igHandle}
      </a>
      <Link href="/" className="inline-flex min-h-12 items-center text-muted underline underline-offset-4">
        Check again
      </Link>
    </div>
  );
}
