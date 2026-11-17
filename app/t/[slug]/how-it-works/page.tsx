import type { Metadata } from "next";
import Link from "next/link";
import { brand } from "@/lib/config";

export const metadata: Metadata = { title: "How it works" };

const everyone = [
  [
    "Nominate.",
    "For one week, add any local Charlotte area pizza place by its Instagram handle, or upvote the ones already listed. No national chains.",
  ],
  ["The field is set.", "The 64 places with the most upvotes make the tournament. More upvotes means a better seed."],
  [
    "Vote.",
    "New matchups open every day at noon and stay open for 24 hours. Swipe toward your pick. One vote per matchup.",
  ],
  ["Winners advance.", "When a matchup closes, the winner moves on. Two weeks later, one place is the champion."],
];

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const base = `/t/${encodeURIComponent(slug)}`;
  const owners = [
    ["It's free.", "There's no cost and nothing to sign up for. If your customers nominate you, you're in."],
    ["Get in the field.", "Ask your followers to upvote you during nomination week. The top 64 make it."],
    ["Know your game day.", "The bracket shows who you play and when your matchup opens."],
    ["Rally your fans.", "Share the voting link in your stories on game day. Every matchup is decided by votes."],
    [
      "Fair play.",
      "One vote per person per matchup. Suspicious voting is reviewed and can be removed from the count.",
    ],
    ["Ties.", "The better seed advances."],
  ];
  return (
    <div className="mx-auto w-full max-w-xl px-4 py-6">
      <div className="flex flex-col gap-6">
        <h1 className="display text-5xl sm:text-6xl">How it works</h1>

        <section className="panel flex flex-col gap-4 p-5" aria-labelledby="everyone">
          <h2 id="everyone" className="display text-3xl">
            For everyone
          </h2>
          <ol className="flex flex-col gap-4 text-lg">
            {everyone.map(([lead, body], i) => (
              <li key={lead} className="flex gap-3">
                <span className="display w-8 shrink-0 text-2xl text-accent">{i + 1}.</span>
                <p>
                  <strong>{lead}</strong> <span className="text-muted">{body}</span>
                </p>
              </li>
            ))}
          </ol>
        </section>

        <section className="panel flex flex-col gap-4 p-5" aria-labelledby="owners">
          <h2 id="owners" className="display text-3xl">
            For restaurant owners
          </h2>
          <ul className="flex flex-col gap-4 text-lg">
            {owners.map(([lead, body]) => (
              <li key={lead}>
                <strong>{lead}</strong> <span className="text-muted">{body}</span>
              </li>
            ))}
            <li>
              <strong>Want out?</strong>{" "}
              <span className="text-muted">
                Message{" "}
                <a
                  href={brand.igUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-chalk underline decoration-accent decoration-2 underline-offset-4"
                >
                  @{brand.igHandle}
                </a>{" "}
                on Instagram and we&apos;ll remove you.
              </span>
            </li>
          </ul>
        </section>

        <Link href={base} className="btn btn-ghost">
          Back to the tournament
        </Link>
      </div>
    </div>
  );
}
