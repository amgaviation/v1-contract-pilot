"use client";

/**
 * Theme-only shell for the signed-out surface (login, welcome). It brings
 * the same Material Dashboard controller + MUI theme the MD components
 * (MDBox/MDInput/MDButton) expect, but none of the dashboard chrome —
 * no Sidenav, no Configurator — because a visitor with no session must
 * never see the authenticated navigation. Light ground only; the dark
 * toggle is a dashboard affordance and has no meaning here.
 */

import PropTypes from "prop-types";

import { ThemeProvider } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";

import MDBox from "@/components/mdpro/MDBox";

import theme from "@/lib/mdpro/theme";
import { MaterialUIControllerProvider } from "@/lib/mdpro/context";

export default function AuthShell({ children }) {
  return (
    <MaterialUIControllerProvider>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <MDBox
          minHeight="100vh"
          display="flex"
          flexDirection="column"
          justifyContent="center"
          alignItems="center"
          px={2}
        >
          {children}
        </MDBox>
      </ThemeProvider>
    </MaterialUIControllerProvider>
  );
}

AuthShell.propTypes = {
  children: PropTypes.node.isRequired,
};
