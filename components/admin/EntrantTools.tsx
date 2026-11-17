"use client";

import { useState } from "react";
import { ActionButton, Btn, ErrorText, inputCls, useAdminPost } from "./ui";

export function EntrantTools({
  id,
  status,
  displayName,
  others,
}: {
  id: string;
  status: string;
  displayName: string;
  others: { id: string; label: string }[];
}) {
  const rename = useAdminPost();
  const merge = useAdminPost();
  const [name, setName] = useState(displayName);
  const [fromId, setFromId] = useState("");
  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-sm font-medium underline">Edit</summary>
      <div className="mt-3 space-y-4">
        <div className="flex flex-wrap gap-2">
          {status === "pending" && (
            <>
              <ActionButton path="/api/admin/entrants/set-status" body={{ id, action: "approve" }} tone="green">Approve</ActionButton>
              <ActionButton path="/api/admin/entrants/set-status" body={{ id, action: "reject" }} tone="red">Reject</ActionButton>
            </>
          )}
          {status === "rejected" && (
            <ActionButton path="/api/admin/entrants/set-status" body={{ id, action: "approve" }} tone="green">Approve</ActionButton>
          )}
          {(status === "approved" || status === "pending") && (
            <ActionButton path="/api/admin/entrants/set-status" body={{ id, action: "withdraw" }} tone="light" confirmText="Withdraw this entrant?">
              Withdraw
            </ActionButton>
          )}
          {status === "withdrawn" && (
            <ActionButton path="/api/admin/entrants/set-status" body={{ id, action: "restore" }} tone="green">Restore</ActionButton>
          )}
        </div>
        <div className="flex gap-2">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} aria-label="Display name" />
          <Btn disabled={rename.busy || !name.trim() || name === displayName} onClick={() => void rename.run("/api/admin/entrants/rename", { id, displayName: name })}>
            Rename
          </Btn>
        </div>
        <ErrorText>{rename.error}</ErrorText>
        {others.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm text-neutral-600">Merge a duplicate into this entrant. The duplicate is rejected and its upvotes move here.</p>
            <select className={inputCls} value={fromId} onChange={(e) => setFromId(e.target.value)}>
              <option value="">Pick the duplicate</option>
              {others.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
            <Btn
              tone="light"
              disabled={merge.busy || !fromId}
              onClick={() => {
                if (window.confirm("Merge that entrant into this one? This cannot be undone.")) void merge.run("/api/admin/entrants/merge", { intoId: id, fromId });
              }}
            >
              Merge into this one
            </Btn>
            <ErrorText>{merge.error}</ErrorText>
          </div>
        )}
      </div>
    </details>
  );
}
