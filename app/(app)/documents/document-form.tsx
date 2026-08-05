"use client";

import { useActionState, useState } from "react";
import NextLink from "next/link";
import Card from "@mui/material/Card";
import Grid from "@mui/material/Grid";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import MDBox from "@/components/mdpro/MDBox";
import MDTypography from "@/components/mdpro/MDTypography";
import MDButton from "@/components/mdpro/MDButton";
import { DOCUMENT_KINDS } from "./kinds";
import type { DocumentFormState } from "./actions";

export type DocumentFormValues = {
  id?: string;
  kind?: string | null;
  label?: string | null;
  issued_on?: string | null;
  expires_on?: string | null;
  client_id?: string | null;
  notes?: string | null;
  file_path?: string | null;
};

export type ClientOption = {
  id: string;
  label: string;
};

const initialState: DocumentFormState = { error: null };

export default function DocumentForm({
  action,
  clients,
  values = {},
  submitLabel,
}: {
  action: (
    state: DocumentFormState,
    formData: FormData
  ) => Promise<DocumentFormState>;
  clients: ClientOption[];
  values?: DocumentFormValues;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);

  const submitted = state.values;
  const initial = (key: string, stored: unknown, fallback = "") => {
    const echoed = submitted?.[key];
    if (echoed !== undefined) return echoed;
    return stored === null || stored === undefined ? fallback : String(stored);
  };

  const [kind, setKind] = useState(() => submitted?.kind ?? (values.kind ?? "other"));

  return (
    <Card>
      <MDBox p={3} component="form" action={formAction}>
        {values.id ? <input type="hidden" name="id" value={values.id} /> : null}

        <MDBox mb={2}>
          <MDTypography variant="h6">What it is</MDTypography>
        </MDBox>
        <Grid container spacing={2}>
          <Grid item xs={12} md={4}>
            <TextField
              select
              name="kind"
              label="Kind"
              fullWidth
              value={kind}
              onChange={(event) => setKind(event.target.value)}
            >
              {DOCUMENT_KINDS.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid item xs={12} md={8}>
            <TextField
              name="label"
              label="Label"
              fullWidth
              required
              defaultValue={initial("label", values.label)}
              helperText='However you’d recognize it — e.g. “First class medical” or “N123AB hull policy”'
            />
          </Grid>
        </Grid>

        <MDBox mt={4} mb={2}>
          <MDTypography variant="h6">Dates</MDTypography>
          <MDTypography variant="button" color="text" fontWeight="regular">
            Enter the dates exactly as printed on the document. Nothing here
            is calculated from the other — an issue date does not imply an
            expiration.
          </MDTypography>
        </MDBox>
        <Grid container spacing={2}>
          <Grid item xs={12} md={6}>
            <TextField
              type="date"
              name="issued_on"
              label="Issued"
              fullWidth
              InputLabelProps={{ shrink: true }}
              defaultValue={initial("issued_on", values.issued_on)}
              helperText="Optional"
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField
              type="date"
              name="expires_on"
              label="Expires"
              fullWidth
              InputLabelProps={{ shrink: true }}
              defaultValue={initial("expires_on", values.expires_on)}
              helperText="Leave blank if this document doesn't expire"
            />
          </Grid>
        </Grid>

        <MDBox mt={4} mb={2}>
          <MDTypography variant="h6">Linked client</MDTypography>
        </MDBox>
        <Grid container spacing={2}>
          <Grid item xs={12} md={6}>
            <TextField
              select
              name="client_id"
              label="Client"
              fullWidth
              defaultValue={initial("client_id", values.client_id)}
              helperText="Optional — e.g. an insurance certificate or W-9 that names one client"
            >
              <MenuItem value="">No client</MenuItem>
              {clients.map((client) => (
                <MenuItem key={client.id} value={client.id}>
                  {client.label}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid item xs={12}>
            <TextField
              name="notes"
              label="Notes"
              fullWidth
              multiline
              rows={2}
              defaultValue={initial("notes", values.notes)}
            />
          </Grid>
        </Grid>

        <MDBox mt={4} mb={2}>
          <MDTypography variant="h6">Scan or photo</MDTypography>
        </MDBox>
        <MDBox>
          {/* A plain file input: the file is stored privately and read back
              through a short-lived signed URL, never a public URL. */}
          <input
            type="file"
            name="file"
            accept="image/jpeg,image/png,image/heic,image/webp,application/pdf"
            aria-label="Document scan or photo"
          />
          <MDBox mt={1}>
            <MDTypography variant="caption" color="text">
              {values.file_path
                ? "A file is already attached. Choosing a file replaces it."
                : "JPEG, PNG, HEIC, WebP or PDF, up to 10 MB. Optional."}
            </MDTypography>
          </MDBox>
        </MDBox>

        <MDBox mt={3} role="alert" aria-live="polite">
          {state.error ? (
            <MDTypography variant="caption" color="error">
              {state.error}
            </MDTypography>
          ) : null}
        </MDBox>

        <MDBox mt={3} display="flex" gap={1.5}>
          <MDButton
            type="submit"
            variant="gradient"
            color="info"
            disabled={pending}
          >
            {pending ? "Saving…" : submitLabel}
          </MDButton>
          <MDButton
            component={NextLink}
            href="/documents"
            variant="outlined"
            color="info"
          >
            Cancel
          </MDButton>
        </MDBox>
      </MDBox>
    </Card>
  );
}
