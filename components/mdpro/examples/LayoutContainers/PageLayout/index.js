"use client";

/**
=========================================================
* Material Dashboard 3 PRO React - v2.4.0
=========================================================

* Product Page: https://www.creative-tim.com/product/material-dashboard-pro-react
* Copyright 2024 Creative Tim (https://www.creative-tim.com)

Coded by www.creative-tim.com

 =========================================================

* The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
*/

import { useEffect } from "react";

// next navigation components (converted from React Router)
import { usePathname } from "next/navigation";

// prop-types is a library for typechecking of props.
import PropTypes from "prop-types";

// Material Dashboard 3 PRO React components
import MDBox from "@/components/mdpro/MDBox";

// Material Dashboard 3 PRO React context
import { useMaterialUIController, setLayout } from "@/lib/mdpro/context";

function PageLayout({ background = "default", children }) {
  const [, dispatch] = useMaterialUIController();
  const pathname = usePathname();

  useEffect(() => {
    setLayout(dispatch, "page");
  }, [pathname]);

  return (
    <MDBox
      width="100vw"
      height="100%"
      minHeight="100vh"
      bgColor={background}
      sx={{ overflowX: "hidden" }}
    >
      {children}
    </MDBox>
  );
}

// Typechecking props for the PageLayout
PageLayout.propTypes = {
  background: PropTypes.oneOf(["white", "light", "default"]),
  children: PropTypes.node.isRequired,
};

export default PageLayout;
