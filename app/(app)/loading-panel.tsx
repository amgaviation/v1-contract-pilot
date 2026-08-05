import Card from "@mui/material/Card";
import MDBox from "@/components/mdpro/MDBox";
import MDTypography from "@/components/mdpro/MDTypography";

/**
 * Segment-level fallback. Each of these screens blocks on a round trip to
 * Supabase before it can render anything — /trips/[id] on three queries —
 * so without a `loading.tsx` the pilot gets a dead screen with no signal
 * that anything is happening.
 */
export default function LoadingPanel({ label }: { label: string }) {
  return (
    <MDBox py={3}>
      <Card>
        <MDBox p={3} role="status" aria-live="polite">
          <MDTypography variant="button" color="text" fontWeight="regular">
            Loading {label}…
          </MDTypography>
        </MDBox>
      </Card>
    </MDBox>
  );
}
