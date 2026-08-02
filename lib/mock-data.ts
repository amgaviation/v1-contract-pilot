/**
 * SYNTHETIC DEMO DATA ONLY. Every name, route, and figure here is
 * invented for the Overview screen scaffold. Nothing here is, or may
 * ever become, live pilot data — see docs/PLAN.md "no live pilot data
 * as fixtures" (§9 Risks / standing gates). This module is deleted once
 * Phase 3 (Clients and Trips) wires the Overview screen to real
 * pilot.trips / pilot.invoices / pilot.expenses queries.
 */

export const DEMO_ACCOUNT = {
  name: "Meridian Air LLC",
  user: "R. Calloway",
};

export type CurrencyRow = {
  label: string;
  detail: string;
  status: "ok" | "bad" | "warn";
  statusLabel: string;
};

export const CURRENCY_ROWS: CurrencyRow[] = [
  { label: "Day passenger", detail: "7 landings / 90 days", status: "ok", statusLabel: "Current" },
  {
    label: "Night passenger",
    detail: "1 of 3 landings · 2 more needed",
    status: "bad",
    statusLabel: "Not current",
  },
  { label: "Instrument", detail: "6 approaches · 1 hold", status: "ok", statusLabel: "Current" },
  {
    label: "First class medical",
    detail: "Expires 30 Nov 2026",
    status: "warn",
    statusLabel: "4 months",
  },
  { label: "Flight review", detail: "Due 31 Mar 2027", status: "ok", statusLabel: "Current" },
  { label: "Passport", detail: "Expires 19 Jun 2027", status: "ok", statusLabel: "Current" },
];

export const CURRENCY_DISCLAIMER =
  "Currency is calculated from the entries you logged and is a planning aid, not a determination of regulatory compliance. You remain responsible for your own currency and airworthiness decisions.";

export type ReadyToInvoiceTrip = {
  client: string;
  route: string;
  amount: string;
  detail: string;
};

export const READY_TO_INVOICE: ReadyToInvoiceTrip[] = [
  {
    client: "Sandhill Capital Partners",
    route: "KFXE → KTEB → KFXE · N412TG · 2 days · 21–22 Jul",
    amount: "$2,900",
    detail: "$2,400 rate + $500 exp",
  },
  {
    client: "Beacon MRO",
    route: "KLAL → KSGJ · N88CV · ferry · 26 Jul",
    amount: "$1,950",
    detail: "$1,600 rate + $350 exp",
  },
];

export type AttentionItem = {
  label: string;
  detail: string;
  action: string;
};

export const NEEDS_ATTENTION: AttentionItem[] = [
  { label: "INV-0041 past due", detail: "Coastal Jet Mgmt · $3,200 · 34 days", action: "Remind" },
  { label: "3 receipts unassigned", detail: "Won't be billed or deducted", action: "Sort" },
  {
    label: "W-9 outstanding",
    detail: "Tarrant Family Office · sent 18 Jul",
    action: "Resend",
  },
];

export const KPIS = [
  { label: "Unbilled work", value: "$6,850", sub: "2 trips · oldest 11 days" },
  { label: "Awaiting payment", value: "$14,200", sub: "3 invoices" },
  { label: "Paid this year", value: "$92,400", sub: "4 clients" },
  { label: "Deductible expenses", value: "$8,475", sub: "41 receipts filed" },
];
