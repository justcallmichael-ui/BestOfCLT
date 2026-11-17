"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Btn, ErrorText, inputCls, postJson } from "./ui";

export function LoginForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        const r = await postJson("/api/admin/login", { password });
        setBusy(false);
        if (!r.ok) return setError(r.data.error ?? "Could not sign in");
        router.push("/admin");
        router.refresh();
      }}
    >
      <input
        type="password"
        autoFocus
        autoComplete="current-password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className={inputCls}
      />
      <Btn big className="w-full" disabled={busy || !password}>
        {busy ? "Checking..." : "Log in"}
      </Btn>
      <ErrorText>{error}</ErrorText>
    </form>
  );
}
