import { StartBanner } from "@/components/StartBanner";
import { TournamentNav } from "@/components/TournamentNav";
import { getDb } from "@/lib/db";

// The nav reads the phase on the server so the Nominate tab never flashes in late.
// Cached for 10 minutes to keep page renders cheap.
export const revalidate = 600;

async function phaseOf(slug: string): Promise<string | null> {
  try {
    const [t] = await getDb().query<{ status: string }>(`select status from tournaments where slug = $1`, [slug]);
    return t?.status ?? null;
  } catch {
    return null;
  }
}

export default async function TournamentLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const status = await phaseOf(slug);
  return (
    <>
      <StartBanner slug={slug} />
      <TournamentNav slug={slug} initialStatus={status} />
      {children}
    </>
  );
}
