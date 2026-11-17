import type { Metadata } from "next";
import { VoteScreen } from "@/components/VoteScreen";

export const metadata: Metadata = { title: "Vote" };

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <VoteScreen slug={slug} />;
}
