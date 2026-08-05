/**
 * MUI theme, wired to the same values as the V1 Design token layer
 * (app/tokens/*.css) so MUI-based components (new template pages) sit
 * visually consistent with the existing hand-written .v1-* system rather
 * than introducing a second, drifting palette. Values are copied, not
 * imported — MUI's theme needs literal JS values at module-eval time, CSS
 * custom properties resolve in the browser. If a token in app/tokens/
 * changes, mirror the change here.
 */
import { createTheme } from "@mui/material/styles";

export const theme = createTheme({
  palette: {
    mode: "light",
    background: {
      default: "#eef1f6",
      paper: "#ffffff",
    },
    text: {
      primary: "#0d1220",
      secondary: "#5a6478",
      disabled: "#8b95a7",
    },
    primary: {
      main: "#2768F5",
      contrastText: "#ffffff",
    },
    success: { main: "#10703f" },
    warning: { main: "#8a5300" },
    error: { main: "#a81f11" },
    divider: "rgb(13 18 32 / 0.11)",
  },
  typography: {
    fontFamily: "var(--font-inter), sans-serif",
    button: { textTransform: "none" },
  },
  shape: {
    borderRadius: 14,
  },
});
