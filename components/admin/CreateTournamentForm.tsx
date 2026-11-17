"use client";

import { useState } from "react";
import { Btn, ErrorText, Field, inputCls, useAdminPost } from "./ui";

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function CreateTournamentForm() {
  const { run, busy, error } = useAdminPost();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [category, setCategory] = useState("");
  const [fieldSize, setFieldSize] = useState(64);
  const [closeAt, setCloseAt] = useState("");
  return (
    <form
      className="space-y-3 rounded-xl border border-neutral-300 bg-white p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await run("/api/admin/tournaments/create", {
          name,
          slug,
          category,
          fieldSize,
          nominationsCloseAt: closeAt ? new Date(closeAt).toISOString() : null,
        });
        if (r) {
          setName("");
          setSlug("");
          setSlugEdited(false);
          setCategory("");
          setCloseAt("");
        }
      }}
    >
      <h2 className="text-lg font-bold">New tournament</h2>
      <Field label="Name">
        <input
          className={inputCls}
          value={name}
          placeholder="Best Pizza in Charlotte"
          onChange={(e) => {
            setName(e.target.value);
            if (!slugEdited) setSlug(slugify(e.target.value));
          }}
        />
      </Field>
      <Field label="Web address ending (slug)">
        <input
          className={inputCls}
          value={slug}
          onChange={(e) => {
            setSlug(e.target.value);
            setSlugEdited(true);
          }}
        />
      </Field>
      <Field label="Category">
        <input className={inputCls} value={category} placeholder="pizza" onChange={(e) => setCategory(e.target.value)} />
      </Field>
      <Field label="Field size">
        <select className={inputCls} value={fieldSize} onChange={(e) => setFieldSize(Number(e.target.value))}>
          <option value={16}>16</option>
          <option value={32}>32</option>
          <option value={64}>64</option>
        </select>
      </Field>
      <Field label="Nominations close (Eastern, optional)">
        <input className={inputCls} type="datetime-local" value={closeAt} onChange={(e) => setCloseAt(e.target.value)} />
      </Field>
      <Btn big className="w-full" disabled={busy || !name || !slug || !category}>
        {busy ? "Creating..." : "Create tournament"}
      </Btn>
      <ErrorText>{error}</ErrorText>
    </form>
  );
}
