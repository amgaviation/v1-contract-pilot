"use client";

import { useState, useTransition } from "react";
import Card from "@mui/material/Card";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import MDBox from "@/components/mdpro/MDBox";
import MDTypography from "@/components/mdpro/MDTypography";
import MDButton from "@/components/mdpro/MDButton";
import { sendInvoice, voidInvoice } from "../actions";

type InvoiceForActions = {
  id: string;
  status: "draft" | "sent" | "partial" | "paid" | "void";
};

/**
 * Mirrors invoices_protect_issued's own forward-only transition table
 * exactly (draft -> sent|void, sent -> partial|paid|void, partial ->
 * paid|void) so a control is never shown for a move the database will
 * reject. That mirroring is a UX nicety, not the enforcement — every
 * action below still goes through the trigger regardless of what this
 * component renders.
 */
export default function StatusActions({
  invoice,
  hasLines,
}: {
  invoice: InvoiceForActions;
  hasLines: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [deliveryMethod, setDeliveryMethod] = useState<"platform_email" | "manual_download">(
    "manual_download"
  );

  if (invoice.status === "paid" || invoice.status === "void") {
    return null;
  }

  const canSend = invoice.status === "draft";
  const canVoid = invoice.status === "draft" || invoice.status === "sent" || invoice.status === "partial";

  return (
    <Card>
      <MDBox p={3}>
        <MDTypography variant="h6" mb={1.5}>
          Status
        </MDTypography>

        {canSend ? (
          <MDBox mb={2}>
            <TextField
              select
              label="Delivery"
              fullWidth
              size="small"
              value={deliveryMethod}
              onChange={(event) =>
                setDeliveryMethod(event.target.value as "platform_email" | "manual_download")
              }
            >
              {/* `platform_email` is a valid value in the schema and is
                  deliberately NOT offered here: nothing in this codebase
                  sends mail. Offering it would let a pilot mark a $14,000
                  invoice "Emailed from here", watch it lock read-only and
                  start ageing toward invoices_overdue, while the client
                  received nothing. The schema permitting a value is not
                  permission for the UI to offer it before a sender
                  exists — put this option back the day one does. */}
              <MenuItem value="manual_download">I&rsquo;ll send it myself</MenuItem>
            </TextField>
            {!hasLines ? (
              // Visible, not a title= on a disabled button: a disabled
              // button is not focusable, so a tooltip is unreachable by
              // keyboard and silent to assistive tech.
              <MDBox mt={1.5}>
                <MDTypography variant="caption" color="text">
                  Add at least one line before sending.
                </MDTypography>
              </MDBox>
            ) : null}
            <MDBox mt={1.5}>
              <MDButton
                variant="gradient"
                color="info"
                fullWidth
                disabled={pending || !hasLines}
                onClick={() => {
                  if (!window.confirm("Mark this invoice as sent? It becomes read-only except for status, notes, and delivery.")) {
                    return;
                  }
                  startTransition(async () => {
                    const result = await sendInvoice(invoice.id, deliveryMethod);
                    setError(result?.error ?? null);
                  });
                }}
              >
                {pending ? "Sending…" : "Mark as sent"}
              </MDButton>
            </MDBox>
          </MDBox>
        ) : null}

        {canVoid ? (
          <MDButton
            variant="outlined"
            color="error"
            fullWidth
            disabled={pending}
            onClick={() => {
              if (!window.confirm("Void this invoice? This can't be undone.")) return;
              startTransition(async () => {
                const result = await voidInvoice(invoice.id);
                setError(result?.error ?? null);
              });
            }}
          >
            {pending ? "Working…" : "Void invoice"}
          </MDButton>
        ) : null}

        {error ? (
          <MDBox mt={1.5} role="alert">
            <MDTypography variant="caption" color="error">
              {error}
            </MDTypography>
          </MDBox>
        ) : null}
      </MDBox>
    </Card>
  );
}
