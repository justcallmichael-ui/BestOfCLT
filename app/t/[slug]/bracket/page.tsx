import type { Metadata } from "next";
import { Bracket } from "@/components/Bracket";

export const metadata: Metadata = { title: "Bracket" };

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <Bracket slug={slug} />;
}
