import { notFound } from "next/navigation";
import { AdminNav } from "@/components/admin/AdminNav";
import { assertUuid, requireAdminPage } from "@/components/admin/guard";
import { PostsDay } from "@/components/share/PostsDay";
import { advanceDueRounds } from "@/lib/services/bracket";
import { getPostsData } from "@/lib/share/posts";

export const dynamic = "force-dynamic";

const steps = [
  "Copy the voting link.",
  "Share the graphic to your Instagram story.",
  "Add the link sticker and paste.",
  "Tag the restaurants.",
];

export default async function PostsPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage();
  const id = assertUuid((await params).id);
  // Same as the public API: make sure games that are due have opened or closed before showing them.
  const now = new Date();
  await advanceDueRounds(now).catch((e) => console.error("advanceDueRounds failed", e));
  const data = await getPostsData(id);
  if (!data) notFound();
  const v = Math.floor(now.getTime() / 60_000);
  return (
    <>
      <AdminNav tournamentId={id} />
      <main className="mx-auto max-w-5xl space-y-6 px-4 py-6">
        <h1 className="text-2xl font-bold">Today&apos;s posts</h1>
        <ol className="list-decimal space-y-1 rounded-xl border border-neutral-300 bg-white py-4 pl-9 pr-4">
          {steps.map((s) => (
            <li key={s} className="text-base">{s}</li>
          ))}
        </ol>
        {data.sections.length === 0 && (
          <p className="text-neutral-600">No game days yet. They show up here once the bracket has started.</p>
        )}
        {data.sections.map((s) => (
          <PostsDay key={s.kind} section={s} tournament={data.tournament} voteUrl={data.voteUrl} v={v} />
        ))}
      </main>
    </>
  );
}
