import type { Metadata } from "next";
import { NominatePanel } from "@/components/NominatePanel";

export const metadata: Metadata = { title: "Nominate" };

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <NominatePanel slug={slug} />;
}
