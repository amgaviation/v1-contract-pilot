"use client";

import { useState, useTransition } from "react";
import { LButton } from "@/components/ledger";
import { documentUrl } from "../actions";

/**
 * Opens the document through a signed URL minted at click time.
 *
 * WHY NOT RENDER THE URL INTO THE PAGE: a signed URL is a bearer token in
 * a query string. Putting one in the HTML means it lands in the RSC
 * payload, in any cache in front of the app, and in the browser history.
 * Minting on demand keeps the exposure to the documents actually opened,
 * and the URL expires a minute later.
 */
export default function DocumentLink({ path }: { path: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-1">
      <LButton
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const url = await documentUrl(path);
            if (!url) {
              setError("Couldn't open that file.");
              return;
            }
            // noopener/noreferrer so the opened tab cannot reach back
            // through window.opener, and the signed URL is not handed to
            // the destination as a Referer.
            window.open(url, "_blank", "noopener,noreferrer");
          })
        }
      >
        {pending ? "Opening…" : "View file"}
      </LButton>
      {error ? (
        <p className="text-caption font-medium text-crit" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
