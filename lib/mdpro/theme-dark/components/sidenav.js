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

// Material Dashboard 3 PRO React base styles
import colors from "@/lib/mdpro/theme-dark/base/colors";
import borders from "@/lib/mdpro/theme-dark/base/borders";

// Material Dashboard 3 PRO React helper functions
import pxToRem from "@/lib/mdpro/theme-dark/functions/pxToRem";

const { background } = colors;
const { borderRadius } = borders;

const sidenav = {
  styleOverrides: {
    root: {
      width: pxToRem(222),
      whiteSpace: "nowrap",
      border: "none",
    },

    paper: {
      width: pxToRem(222),
      backgroundColor: background.sidenav,
      height: `calc(100vh - ${pxToRem(16)})`,
      margin: pxToRem(8),
      borderRadius: borderRadius.lg,
      border: "none",
    },

    paperAnchorDockedLeft: {
      borderRight: "none",
    },
  },
};

export default sidenav;
