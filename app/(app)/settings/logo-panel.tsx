"use client";

import { useActionState, useState, useTransition } from "react";
import { LButton, LCard } from "@/components/ledger";
import {
  uploadLogo,
  removeLogo,
  logoPreviewUrl,
  type SettingsFormState,
} from "./actions";

const initialState: SettingsFormState = { error: null };

export default function LogoPanel({
  hasLogo,
  canEdit,
}: {
  hasLogo: boolean;
  canEdit: boolean;
}) {
  const [state, formAction, pending] = useActionState(uploadLogo, initialState);
  const [removing, startRemove] = useTransition();
  const [previewing, startPreview] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <LCard>
      <div className="flex flex-col gap-3">
        <h3 className="text-h3 font-semibold">Logo</h3>

        {hasLogo ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-body-s text-ink-2">A logo is on file.</p>
            {/* Opened through a signed URL minted at click time rather than
                rendered inline — the same rule receipts follow, since a
                signed URL is a bearer token in a query string. */}
            <LButton
              type="button"
              variant="outline"
              size="sm"
              disabled={previewing}
              onClick={() =>
                startPreview(async () => {
                  setError(null);
                  const url = await logoPreviewUrl();
                  if (!url) {
                    setError("Couldn't open that logo.");
                    return;
                  }
                  window.open(url, "_blank", "noopener,noreferrer");
                })
              }
            >
              {previewing ? "Opening…" : "View"}
            </LButton>
            {canEdit ? (
              <LButton
                type="button"
                variant="danger"
                size="sm"
                disabled={removing}
                onClick={() =>
                  startRemove(async () => {
                    setError(null);
                    const result = await removeLogo();
                    setError(result.error);
                  })
                }
              >
                {removing ? "Removing…" : "Remove"}
              </LButton>
            ) : null}
          </div>
        ) : null}

        {canEdit ? (
          <form action={formAction}>
            <div className="flex flex-col items-start gap-2">
              <input
                type="file"
                name="logo"
                accept="image/png,image/jpeg"
                aria-label="Logo image"
                className="text-body-s text-ink-2"
              />
              <LButton type="submit" variant="outline" disabled={pending}>
                {pending ? "Uploading…" : hasLogo ? "Replace logo" : "Upload logo"}
              </LButton>
            </div>
          </form>
        ) : null}

        <div role="alert" aria-live="polite">
          {state.error ?? error ? (
            <p className="text-caption font-medium text-crit">{state.error ?? error}</p>
          ) : state.saved ? (
            <p className="text-caption font-medium text-good">Logo saved.</p>
          ) : null}
        </div>
      </div>
    </LCard>
  );
}
