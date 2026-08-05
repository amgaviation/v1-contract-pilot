"use client";

/**
 * Sidenav routes for the app's real navigation (ported from the old
 * rail-nav). Shape follows the Material Dashboard 3 PRO React kit's
 * src/routes.js contract as consumed by
 * components/mdpro/examples/Sidenav/index.js:
 *
 *   { type: "collapse", noCollapse: true, name, key, route, icon }
 *
 * Active-state gotcha, straight from the Sidenav source: it computes
 * `collapseName = pathname.split("/").slice(1)[0]` and highlights the
 * entry whose `key` string-equals that segment. At "/" that expression
 * yields "" (the empty string), so Overview's key MUST be "" — any other
 * key would never light up on the home route. Every other key must equal
 * its route's first URL segment for the same reason.
 *
 * Icons are Material Icons font ligatures (the stylesheet is linked in
 * app/layout.tsx), rendered through MUI's <Icon>.
 */

import Icon from "@mui/material/Icon";

const routes = [
  {
    type: "collapse",
    noCollapse: true,
    name: "Overview",
    // "" on purpose — matches pathname.split("/").slice(1)[0] at "/".
    key: "",
    route: "/",
    icon: <Icon fontSize="small">dashboard</Icon>,
  },
  {
    type: "collapse",
    noCollapse: true,
    name: "Trips",
    key: "trips",
    route: "/trips",
    icon: <Icon fontSize="small">flight_takeoff</Icon>,
  },
  {
    type: "collapse",
    noCollapse: true,
    name: "Invoices",
    key: "invoices",
    route: "/invoices",
    icon: <Icon fontSize="small">receipt_long</Icon>,
  },
  {
    type: "collapse",
    noCollapse: true,
    name: "Expenses",
    key: "expenses",
    route: "/expenses",
    icon: <Icon fontSize="small">payments</Icon>,
  },
  {
    type: "collapse",
    noCollapse: true,
    name: "Logbook",
    key: "logbook",
    route: "/logbook",
    icon: <Icon fontSize="small">menu_book</Icon>,
  },
  {
    type: "collapse",
    noCollapse: true,
    name: "Clients",
    key: "clients",
    route: "/clients",
    icon: <Icon fontSize="small">groups</Icon>,
  },
  {
    type: "collapse",
    noCollapse: true,
    name: "Documents",
    key: "documents",
    route: "/documents",
    icon: <Icon fontSize="small">folder</Icon>,
  },
];

export default routes;
