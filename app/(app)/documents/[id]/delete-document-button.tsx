"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import MDBox from "@/components/mdpro/MDBox";
import MDTypography from "@/components/mdpro/MDTypography";
import MDButton from "@/components/mdpro/MDButton";
import { deleteDocument } from "../actions";

export default function DeleteDocumentButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <MDBox textAlign="right">
      <MDButton
        variant="outlined"
        color="error"
        disabled={pending}
        onClick={() => {
          if (!window.confirm("Delete this document and its file?")) return;
          startTransition(async () => {
            const result = await deleteDocument(id);
            if (result.error) {
              setError(result.error);
              return;
            }
            // The action doesn't redirect — it can't, since it also has to
            // report a failure back here — so navigation is this
            // component's job once the delete lands.
            router.push("/documents");
          });
        }}
      >
        {pending ? "Deleting…" : "Delete document"}
      </MDButton>
      {error ? (
        <MDBox mt={1} role="alert">
          <MDTypography variant="caption" color="error">
            {error}
          </MDTypography>
        </MDBox>
      ) : null}
    </MDBox>
  );
}
