"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

export async function postJson<T = unknown>(path: string, body: unknown): Promise<{ ok: boolean; data: T & { error?: string } }> {
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, data };
  } catch {
    return { ok: false, data: { error: "Network problem. Try again." } as T & { error?: string } };
  }
}

/** Posts to an admin route, refreshes the page on success, exposes busy and error state. */
export function useAdminPost() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run<T = unknown>(path: string, body: unknown): Promise<T | null> {
    setBusy(true);
    setError(null);
    const r = await postJson<T>(path, body);
    setBusy(false);
    if (!r.ok) {
      if (path !== "/api/admin/login" && (r.data as { error?: string }).error === "Not signed in") {
        router.push("/admin/login");
        return null;
      }
      setError((r.data as { error?: string }).error ?? "Failed");
      return null;
    }
    router.refresh();
    return r.data as T;
  }
  return { run, busy, error };
}

const tones = {
  green: "bg-green-600 text-white",
  red: "bg-red-600 text-white",
  dark: "bg-neutral-900 text-white",
  light: "bg-white text-neutral-900 border border-neutral-300",
} as const;

export function Btn({
  tone = "dark",
  big,
  className = "",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: keyof typeof tones; big?: boolean }) {
  return (
    <button
      {...rest}
      className={`rounded-lg font-semibold disabled:opacity-50 ${big ? "min-h-14 px-5 text-lg" : "min-h-11 px-4 text-base"} ${tones[tone]} ${className}`}
    />
  );
}

export function ActionButton({
  path,
  body,
  children,
  tone = "dark",
  big,
  confirmText,
  className,
}: {
  path: string;
  body: unknown;
  children: ReactNode;
  tone?: keyof typeof tones;
  big?: boolean;
  confirmText?: string;
  className?: string;
}) {
  const { run, busy, error } = useAdminPost();
  return (
    <span className={`inline-flex flex-col ${className ?? ""}`}>
      <Btn
        tone={tone}
        big={big}
        disabled={busy}
        onClick={() => {
          if (confirmText && !window.confirm(confirmText)) return;
          void run(path, body);
        }}
      >
        {busy ? "Working..." : children}
      </Btn>
      {error && <span className="mt-1 text-sm text-red-700">{error}</span>}
    </span>
  );
}

export const inputCls = "w-full min-h-11 rounded-lg border border-neutral-300 bg-white px-3 text-base text-neutral-900";

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-neutral-700">{label}</span>
      {children}
    </label>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  return children ? <p className="text-sm text-red-700">{children}</p> : null;
}

export function LogoutButton() {
  const router = useRouter();
  return (
    <button
      className="text-sm underline"
      onClick={async () => {
        await postJson("/api/admin/logout", {});
        router.push("/admin/login");
        router.refresh();
      }}
    >
      Log out
    </button>
  );
}
