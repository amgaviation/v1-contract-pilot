"use client";

/**
 * App shell for the ported Material Dashboard 3 PRO React system.
 *
 * This replicates the runtime structure of the kit's src/App.js minus
 * the kit's client-side router (Next's App Router owns routing — pages
 * render as {children}) and minus RTL (the RTL themes were not ported; the
 * context's `direction` state exists but has no visual effect).
 *
 * Layering: the default export wraps children in
 * MaterialUIControllerProvider; the inner component reads the controller
 * and mounts ThemeProvider / CssBaseline / Sidenav / Configurator / the
 * floating settings button. The MUI theme object contains functions
 * (pxToRem, rgba, ...) so it must only ever be touched inside this
 * "use client" module — never across an RSC boundary.
 *
 * Brand note: the ported Sidenav's `brand` prop is an <img src> STRING
 * (PropTypes.string, rendered via MDBox component="img"), so the inline
 * SVG Logo component (components/ui/logo.tsx) cannot be passed there.
 * We render brandName text only (BRAND.name); Logo stays available for
 * surfaces that accept a node.
 */

import { useState, useEffect } from "react";

// next navigation (converted from the kit router's useLocation)
import { usePathname } from "next/navigation";

// prop-types is a library for typechecking of props
import PropTypes from "prop-types";

// @mui material components
import { ThemeProvider } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import Icon from "@mui/material/Icon";

// Material Dashboard 3 PRO React components
import MDBox from "@/components/mdpro/MDBox";

// Material Dashboard 3 PRO React examples
import Sidenav from "@/components/mdpro/examples/Sidenav";
import Configurator from "@/components/mdpro/examples/Configurator";

// Material Dashboard 3 PRO React themes
import theme from "@/lib/mdpro/theme";
import themeDark from "@/lib/mdpro/theme-dark";

// Material Dashboard 3 PRO React routes
import routes from "@/lib/mdpro/routes";

// Material Dashboard 3 PRO React contexts
import {
  MaterialUIControllerProvider,
  useMaterialUIController,
  setMiniSidenav,
  setOpenConfigurator,
} from "@/lib/mdpro/context";

// Brand strings — the single permitted source (lib/brand.ts)
import { BRAND } from "@/lib/brand";

function AppShellContent({ children }) {
  const [controller, dispatch] = useMaterialUIController();
  const {
    miniSidenav,
    direction,
    layout,
    openConfigurator,
    sidenavColor,
    darkMode,
  } = controller;
  const [onMouseEnter, setOnMouseEnter] = useState(false);
  const pathname = usePathname();

  // Open sidenav when mouse enter on mini sidenav
  const handleOnMouseEnter = () => {
    if (miniSidenav && !onMouseEnter) {
      setMiniSidenav(dispatch, false);
      setOnMouseEnter(true);
    }
  };

  // Close sidenav when mouse leave mini sidenav
  const handleOnMouseLeave = () => {
    if (onMouseEnter) {
      setMiniSidenav(dispatch, true);
      setOnMouseEnter(false);
    }
  };

  // Change the openConfigurator state
  const handleConfiguratorOpen = () =>
    setOpenConfigurator(dispatch, !openConfigurator);

  // Setting the dir attribute for the body element (parity with the kit;
  // only "ltr" ever has styling behind it since RTL was not ported)
  useEffect(() => {
    document.body.setAttribute("dir", direction);
  }, [direction]);

  // Setting page scroll to 0 when changing the route
  useEffect(() => {
    document.documentElement.scrollTop = 0;
    document.scrollingElement.scrollTop = 0;
  }, [pathname]);

  const configsButton = (
    <MDBox
      display="flex"
      justifyContent="center"
      alignItems="center"
      width="3.25rem"
      height="3.25rem"
      bgColor="white"
      shadow="sm"
      borderRadius="50%"
      position="fixed"
      right="2rem"
      bottom="2rem"
      zIndex={99}
      color="dark"
      sx={{ cursor: "pointer" }}
      onClick={handleConfiguratorOpen}
    >
      <Icon fontSize="small" color="inherit">
        settings
      </Icon>
    </MDBox>
  );

  return (
    <ThemeProvider theme={darkMode ? themeDark : theme}>
      <CssBaseline />
      {layout === "dashboard" && (
        <>
          <Sidenav
            color={sidenavColor}
            brandName={BRAND.name}
            routes={routes}
            onMouseEnter={handleOnMouseEnter}
            onMouseLeave={handleOnMouseLeave}
          />
          <Configurator />
          {configsButton}
        </>
      )}
      {layout === "vr" && <Configurator />}
      {children}
    </ThemeProvider>
  );
}

AppShellContent.propTypes = {
  children: PropTypes.node.isRequired,
};

export default function AppShell({ children }) {
  return (
    <MaterialUIControllerProvider>
      <AppShellContent>{children}</AppShellContent>
    </MaterialUIControllerProvider>
  );
}

AppShell.propTypes = {
  children: PropTypes.node.isRequired,
};
