// Browser fetch wrapper. Every call carries an x-fp fingerprint header.

export type Entrant = {
  id: string;
  igHandle: string;
  displayName: string;
  seed: number | null;
};

export type TournamentStatus = "draft" | "nominations" | "bracket" | "complete";

export type MatchupStatus = "scheduled" | "open" | "closed";

export type MatchupCard = {
  id: string;
  roundName: string;
  region: number | null;
  slot: number;
  status: MatchupStatus;
  opensAt: string;
  closesAt: string;
  a: Entrant | null;
  b: Entrant | null;
  votesA: number | null;
  votesB: number | null;
  winnerId: string | null;
};

export type TournamentState = {
  tournament: {
    slug: string;
    name: string;
    category: string;
    status: TournamentStatus;
    fieldSize: number;
    nominationsCloseAt: string | null;
  };
  currentRound: { id: string; number: number; name: string; closesAt: string } | null;
  champion: Entrant | null;
  live: MatchupCard[];
  upNext: MatchupCard[];
  latestResults: MatchupCard[];
  nextOpensAt: string | null;
  scoresAsOf: string;
};

export type BracketMatchup = {
  id: string;
  status: MatchupStatus;
  opensAt: string;
  closesAt: string;
  slot: number;
  region: number | null;
  a: Entrant | null;
  b: Entrant | null;
  votesA: number | null;
  votesB: number | null;
  winnerId: string | null;
};

export type BracketRound = {
  number: number;
  name: string;
  status: "scheduled" | "open" | "closed";
  opensAt: string | null;
  closesAt: string | null;
  matchups: BracketMatchup[];
};

export type EntrantRow = {
  id: string;
  igHandle: string;
  displayName: string;
  upvoteCount: number;
  upvotedByMe: boolean;
};

export type BracketResponse = { rounds: BracketRound[]; scoresAsOf: string };

export type NominateResult =
  | "created_pending"
  | "upvoted"
  | "already_upvoted"
  | "rejected"
  | "closed"
  | "invalid_handle";

export type VoteResponse = {
  ok: true;
  already: boolean;
  votesA: number;
  votesB: number;
  next: NextMatchup;
};

export type NextMatchup = {
  matchup: {
    id: string;
    roundName: string;
    closesAt: string;
    a: Entrant;
    b: Entrant;
  } | null;
  remaining: number;
  nextOpensAt: string | null;
};

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function fnv(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

let fpPromise: Promise<string> | null = null;

function getFingerprint(): Promise<string> {
  if (fpPromise) return fpPromise;
  fpPromise = (async () => {
    try {
      let tz = "";
      try {
        tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
      } catch {
        tz = "";
      }
      const raw = [
        navigator.userAgent,
        navigator.language,
        tz,
        `${screen.width}x${screen.height}x${window.devicePixelRatio || 1}`,
      ].join("|");
      if (typeof crypto !== "undefined" && crypto.subtle) {
        const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
        return Array.from(new Uint8Array(buf))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
      }
      return fnv(raw) + fnv(raw.split("").reverse().join(""));
    } catch {
      return "unknown";
    }
  })();
  return fpPromise;
}

async function request<T>(path: string, init: { method?: string; body?: unknown; shared?: boolean } = {}): Promise<T> {
  const fp = await getFingerprint();
  const headers: Record<string, string> = { "x-fp": fp, accept: "application/json" };
  if (init.body !== undefined) headers["content-type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? "GET",
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      // Shared public reads honor the CDN and browser cache lifetime; everything else is never cached.
      cache: init.shared ? "default" : "no-store",
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError(0, "Could not reach the server. Check your connection and try again.");
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const msg =
      data && typeof data === "object" && "error" in data && typeof (data as { error: unknown }).error === "string"
        ? (data as { error: string }).error
        : "Something went wrong. Try again.";
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

const enc = encodeURIComponent;

export const api = {
  getTournament: (slug: string) => request<TournamentState>(`/api/t/${enc(slug)}`, { shared: true }),
  getBracket: (slug: string) => request<BracketResponse>(`/api/t/${enc(slug)}/bracket`, { shared: true }),
  getEntrants: (slug: string) => request<{ entrants: EntrantRow[] }>(`/api/t/${enc(slug)}/entrants`),
  nominate: (slug: string, handle: string, displayName?: string) =>
    request<{ result: NominateResult; entrantId?: string }>("/api/nominate", {
      method: "POST",
      body: displayName ? { slug, handle, displayName } : { slug, handle },
    }),
  upvote: (entrantId: string) =>
    request<{ ok: true; already: boolean; upvoteCount: number }>("/api/upvote", {
      method: "POST",
      body: { entrantId },
    }),
  nextMatchup: (slug: string) => request<NextMatchup>(`/api/t/${enc(slug)}/next`),
  vote: (matchupId: string, choice: "a" | "b") =>
    request<VoteResponse>("/api/vote", {
      method: "POST",
      body: { matchupId, choice },
    }),
};

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 404) return "We could not find that tournament.";
    return e.message;
  }
  return "Something went wrong. Try again.";
}
