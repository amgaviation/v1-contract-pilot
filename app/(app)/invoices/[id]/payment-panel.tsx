"use client";

import { useActionState } from "react";
import Card from "@mui/material/Card";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import MDBox from "@/components/mdpro/MDBox";
import MDTypography from "@/components/mdpro/MDTypography";
import MDButton from "@/components/mdpro/MDButton";
import { formatCents, formatDate } from "@/lib/format";
import { recordPayment, type InvoiceFormState } from "../actions";

export type PaymentRow = {
  id: string;
  paid_on: string;
  amount_cents: number;
  method: "ach" | "check" | "wire" | "card" | "cash" | "other" | null;
  notes: string | null;
};

const METHODS = [
  { value: "", label: "Unspecified" },
  { value: "ach", label: "ACH" },
  { value: "check", label: "Check" },
  { value: "wire", label: "Wire" },
  { value: "card", label: "Card" },
  { value: "cash", label: "Cash" },
  { value: "other", label: "Other" },
];

const initialState: InvoiceFormState = { error: null };

export default function PaymentPanel({
  invoiceId,
  status,
  payments,
}: {
  invoiceId: string;
  status: "draft" | "sent" | "partial" | "paid" | "void";
  payments: PaymentRow[];
}) {
  const [state, formAction, pending] = useActionState(recordPayment, initialState);
  // invoice_payments_validate only accepts a payment against 'sent' or
  // 'partial' — matching that here so the form isn't offered where the
  // database would refuse it (draft has nothing committed to pay yet,
  // paid/void are settled/dead).
  const canRecordPayment = status === "sent" || status === "partial";

  return (
    <Card>
      <MDBox p={3}>
        <MDTypography variant="h6" mb={1.5}>
          Payments
        </MDTypography>

        {payments.length === 0 ? (
          <MDTypography variant="button" color="text" fontWeight="regular">
            No payments recorded yet.
          </MDTypography>
        ) : (
          <MDBox display="flex" flexDirection="column" gap={1} mb={canRecordPayment ? 2 : 0}>
            {payments.map((payment) => (
              <MDBox key={payment.id} display="flex" justifyContent="space-between">
                <MDTypography variant="button" color="text" fontWeight="regular">
                  {formatDate(payment.paid_on)}
                  {payment.method ? ` · ${payment.method}` : ""}
                </MDTypography>
                <MDTypography variant="button" fontWeight="medium">
                  {formatCents(payment.amount_cents)}
                </MDTypography>
              </MDBox>
            ))}
          </MDBox>
        )}

        {canRecordPayment ? (
          <MDBox component="form" action={formAction} mt={2}>
            <input type="hidden" name="invoice_id" value={invoiceId} />
            <MDBox display="flex" flexDirection="column" gap={1.5}>
              <TextField
                type="date"
                name="paid_on"
                label="Date received"
                size="small"
                InputLabelProps={{ shrink: true }}
                defaultValue={new Date().toISOString().slice(0, 10)}
              />
              <TextField name="amount" label="Amount (USD)" size="small" inputMode="decimal" />
              <TextField select name="method" label="Method" size="small" defaultValue="">
                {METHODS.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </TextField>
              <TextField name="notes" label="Notes" size="small" />
            </MDBox>
            <MDBox mt={1.5} role="alert" aria-live="polite">
              {state.error ? (
                <MDTypography variant="caption" color="error">
                  {state.error}
                </MDTypography>
              ) : state.saved ? (
                <MDTypography variant="caption" color="success">
                  Payment recorded.
                </MDTypography>
              ) : null}
            </MDBox>
            <MDBox mt={1.5}>
              <MDButton type="submit" variant="gradient" color="info" fullWidth disabled={pending}>
                {pending ? "Recording…" : "Record payment"}
              </MDButton>
            </MDBox>
          </MDBox>
        ) : null}
      </MDBox>
    </Card>
  );
}
