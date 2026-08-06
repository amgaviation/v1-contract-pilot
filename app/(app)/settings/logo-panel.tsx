"use client";

import { useActionState, useState, useTransition } from "react";
import Card from "@mui/material/Card";
import MDBox from "@/components/mdpro/MDBox";
import MDTypography from "@/components/mdpro/MDTypography";
import MDButton from "@/components/mdpro/MDButton";
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
    <Card>
      <MDBox p={3}>
        <MDBox mb={2} lineHeight={1.25}>
          <MDTypography variant="h6">Logo</MDTypography>
          <MDTypography variant="button" color="text" fontWeight="regular">
            Printed at the top of your invoices. PNG or JPEG, up to 2 MB.
          </MDTypography>
        </MDBox>

        {hasLogo ? (
          <MDBox mb={2} display="flex" gap={1.5} alignItems="center" flexWrap="wrap">
            <MDTypography variant="button" color="text" fontWeight="regular">
              A logo is on file.
            </MDTypography>
            {/* Opened through a signed URL minted at click time rather than
                rendered inline — the same rule receipts follow, since a
                signed URL is a bearer token in a query string. */}
            <MDButton
              variant="outlined"
              color="info"
              size="small"
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
            </MDButton>
            {canEdit ? (
              <MDButton
                variant="outlined"
                color="error"
                size="small"
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
              </MDButton>
            ) : null}
          </MDBox>
        ) : null}

        {canEdit ? (
          <MDBox component="form" action={formAction}>
            <input
              type="file"
              name="logo"
              accept="image/png,image/jpeg"
              aria-label="Logo image"
            />
            <MDBox mt={2}>
              <MDButton
                type="submit"
                variant="outlined"
                color="info"
                disabled={pending}
              >
                {pending ? "Uploading…" : hasLogo ? "Replace logo" : "Upload logo"}
              </MDButton>
            </MDBox>
          </MDBox>
        ) : null}

        <MDBox mt={2} role="alert" aria-live="polite">
          {state.error ?? error ? (
            <MDTypography variant="caption" color="error">
              {state.error ?? error}
            </MDTypography>
          ) : state.saved ? (
            <MDTypography variant="caption" color="success">
              Logo saved.
            </MDTypography>
          ) : null}
        </MDBox>
      </MDBox>
    </Card>
  );
}
