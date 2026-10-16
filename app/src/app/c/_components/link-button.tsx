"use client";

import { useState, useTransition } from "react";
import { Button, Notice, field, label } from "@/app/firmar/_components/ui";

export function LinkButton({
  label: buttonLabel,
  empty,
  load,
}: {
  label: string;
  empty: string;
  load: () => Promise<{ name: string; url: string }[]>;
}) {
  const [links, setLinks] = useState<{ name: string; url: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="space-y-3">
      <Button
        type="button"
        disabled={pending}
        onClick={() => {
          setError(null);
          start(async () => {
            try {
              setLinks(await load());
            } catch (e) {
              setError(e instanceof Error ? e.message : "Could not create the links.");
            }
          });
        }}
      >
        {pending ? "Creating links…" : buttonLabel}
      </Button>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {links && links.length === 0 ? <Notice tone="info">{empty}</Notice> : null}
      {links && links.length > 0 ? (
        <ul className="space-y-3">
          {links.map((link) => (
            <li key={link.url}>
              <label className={label}>
                {link.name}
                <input className={field} readOnly value={link.url} onFocus={(e) => e.currentTarget.select()} />
              </label>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
