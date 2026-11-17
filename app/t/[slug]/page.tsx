import type { Metadata } from "next";
import { TournamentHome } from "@/components/TournamentHome";

export const metadata: Metadata = { title: "Tournament" };

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <TournamentHome slug={slug} />;
}
