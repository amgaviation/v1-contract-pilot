"use client";

import { useState, useTransition } from "react";
import { Box, Button, Text } from "@/components/ui";
import { receiptUrl } from "../actions";

/**
 * Opens the receipt through a signed URL minted at click time.
 *
 * WHY NOT RENDER THE URL INTO THE PAGE: a signed URL is a bearer token in
 * a query string. Putting one in the HTML means it lands in the RSC
 * payload, in any cache in front of the app, and in the browser history —
 * for every receipt on the page, whether or not the pilot ever looks at
 * one. Minting on demand keeps the exposure to the receipts actually
 * opened, and the URL expires a minute later.
 */
export default function ReceiptLink({ path }: { path: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <Box>
      <Button
        variant="outline"
        size="2"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const url = await receiptUrl(path);
            if (!url) {
              setError("Couldn't open that receipt.");
              return;
            }
            // noopener/noreferrer so the opened tab cannot reach back
            // through window.opener, and the signed URL is not handed to
            // the destination as a Referer.
            window.open(url, "_blank", "noopener,noreferrer");
          })
        }
      >
        {pending ? "Opening…" : "View receipt"}
      </Button>
      {error ? (
        <Box mt="2" role="alert">
          <Text size="1" color="red">
            {error}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}
