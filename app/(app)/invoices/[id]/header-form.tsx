"use client";

import { useActionState } from "react";
import Card from "@mui/material/Card";
import Grid from "@mui/material/Grid";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import MDBox from "@/components/mdpro/MDBox";
import MDTypography from "@/components/mdpro/MDTypography";
import MDButton from "@/components/mdpro/MDButton";
import { formatDate } from "@/lib/format";
import { updateInvoiceHeader, updateInvoiceNotes, type InvoiceFormState } from "../actions";

export type ClientOption = { id: string; name: string };

type InvoiceForForm = {
  id: string;
  client_id: string;
  issued_on: string | null;
  due_on: string | null;
  tax_rate_bps: number;
  notes: string | null;
};

const initialState: InvoiceFormState = { error: null };

export default function HeaderForm({
  invoice,
  clients,
  locked,
}: {
  invoice: InvoiceForForm;
  clients: ClientOption[];
  locked: boolean;
}) {
  if (locked) {
    return <LockedHeader invoice={invoice} clients={clients} />;
  }
  return <DraftHeader invoice={invoice} clients={clients} />;
}

function DraftHeader({
  invoice,
  clients,
}: {
  invoice: InvoiceForForm;
  clients: ClientOption[];
}) {
  const [state, formAction, pending] = useActionState(updateInvoiceHeader, initialState);

  // Echoes the submitted values on a validation error — otherwise React 19
  // resets this uncontrolled form to `invoice`'s last-SAVED values on every
  // dispatch, including the error path, and the pilot's edits vanish.
  const submitted = state.values;
  const initial = (key: string, stored: unknown, fallback = "") => {
    const echoed = submitted?.[key];
    if (echoed !== undefined) return echoed;
    return stored === null || stored === undefined ? fallback : String(stored);
  };

  return (
    <Card>
      <MDBox p={3} component="form" action={formAction}>
        <input type="hidden" name="id" value={invoice.id} />
        <MDTypography variant="h6" mb={2}>
          Billing details
        </MDTypography>
        <Grid container spacing={2}>
          <Grid item xs={12} md={6}>
            <TextField
              select
              name="client_id"
              label="Client"
              fullWidth
              defaultValue={initial("client_id", invoice.client_id)}
            >
              {clients.map((client) => (
                <MenuItem key={client.id} value={client.id}>
                  {client.name}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid item xs={6} md={3}>
            <TextField
              type="date"
              name="issued_on"
              label="Issue date"
              fullWidth
              InputLabelProps={{ shrink: true }}
              defaultValue={initial("issued_on", invoice.issued_on)}
              helperText="Defaults to today when sent"
            />
          </Grid>
          <Grid item xs={6} md={3}>
            <TextField
              type="date"
              name="due_on"
              label="Due date"
              fullWidth
              InputLabelProps={{ shrink: true }}
              defaultValue={initial("due_on", invoice.due_on)}
              helperText="Defaults from the client's terms"
            />
          </Grid>
          <Grid item xs={12} md={4}>
            <TextField
              name="tax_rate_percent"
              label="Tax rate (%)"
              fullWidth
              inputMode="decimal"
              defaultValue={initial(
                "tax_rate_percent",
                (invoice.tax_rate_bps / 100).toString()
              )}
            />
          </Grid>
          <Grid item xs={12} md={8}>
            <TextField
              name="notes"
              label="Notes"
              fullWidth
              defaultValue={initial("notes", invoice.notes)}
            />
          </Grid>
        </Grid>

        <MDBox mt={2} role="alert" aria-live="polite">
          {state.error ? (
            <MDTypography variant="caption" color="error">
              {state.error}
            </MDTypography>
          ) : state.saved ? (
            <MDTypography variant="caption" color="success">
              Saved.
            </MDTypography>
          ) : null}
        </MDBox>

        <MDBox mt={2}>
          <MDButton type="submit" variant="gradient" color="info" disabled={pending}>
            {pending ? "Saving…" : "Save details"}
          </MDButton>
        </MDBox>
      </MDBox>
    </Card>
  );
}

/**
 * Once issued, invoices_protect_issued only lets status/sent_at/
 * delivery_method/notes change at the database — the client/dates/tax
 * fields are shown read-only rather than as disabled inputs, because a
 * disabled control is a UI convention, not enforcement (the actual
 * enforcement is the trigger; this just keeps the screen honest about it).
 */
function LockedHeader({
  invoice,
  clients,
}: {
  invoice: InvoiceForForm;
  clients: ClientOption[];
}) {
  const [state, formAction, pending] = useActionState(updateInvoiceNotes, initialState);
  const clientName = clients.find((c) => c.id === invoice.client_id)?.name ?? "—";

  return (
    <Card>
      <MDBox p={3}>
        <MDTypography variant="h6" mb={2}>
          Billing details
        </MDTypography>
        <Grid container spacing={2}>
          <Grid item xs={12} md={6}>
            <MDTypography variant="caption" color="text" textTransform="uppercase">
              Client
            </MDTypography>
            <MDTypography variant="button" fontWeight="medium" display="block">
              {clientName}
            </MDTypography>
          </Grid>
          <Grid item xs={6} md={3}>
            <MDTypography variant="caption" color="text" textTransform="uppercase">
              Issued
            </MDTypography>
            <MDTypography variant="button" fontWeight="medium" display="block">
              {formatDate(invoice.issued_on)}
            </MDTypography>
          </Grid>
          <Grid item xs={6} md={3}>
            <MDTypography variant="caption" color="text" textTransform="uppercase">
              Due
            </MDTypography>
            <MDTypography variant="button" fontWeight="medium" display="block">
              {formatDate(invoice.due_on)}
            </MDTypography>
          </Grid>
        </Grid>

        <MDBox mt={2} component="form" action={formAction}>
          <input type="hidden" name="id" value={invoice.id} />
          <TextField
            name="notes"
            label="Notes"
            fullWidth
            defaultValue={invoice.notes ?? ""}
            helperText="This is issued — only notes and delivery status can still change."
          />
          <MDBox mt={1} role="alert" aria-live="polite">
            {state.error ? (
              <MDTypography variant="caption" color="error">
                {state.error}
              </MDTypography>
            ) : state.saved ? (
              <MDTypography variant="caption" color="success">
                Saved.
              </MDTypography>
            ) : null}
          </MDBox>
          <MDBox mt={1.5}>
            <MDButton type="submit" variant="outlined" color="info" size="small" disabled={pending}>
              {pending ? "Saving…" : "Save notes"}
            </MDButton>
          </MDBox>
        </MDBox>
      </MDBox>
    </Card>
  );
}
