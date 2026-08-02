/**
 * SYNTHETIC DEMO DATA ONLY. Every name, route, and figure here is
 * invented for the Overview screen scaffold. Nothing here is, or may
 * ever become, live pilot data — see docs/PLAN.md "no live pilot data
 * as fixtures" (§9 Risks / standing gates). This module is deleted once
 * Phase 3 (Clients and Trips) wires the Overview screen to real
 * pilot.trips / pilot.invoices / pilot.expenses queries.
 *
 * CURRENCY_DISCLAIMER deliberately does NOT live here — it's
 * counsel-reviewed copy that must survive this file's eventual deletion
 * unchanged. It's exported from lib/brand.ts and re-exported below only
 * for import-path convenience on this screen.
 */

export { CURRENCY_DISCLAIMER } from "@/lib/brand";

export const DEMO_ACCOUNT = {
  name: "Meridian Air LLC",
  user: "R. Calloway",
};

export type CurrencyRow = {
  id: string;
  label: string;
  detail: string;
  status: "ok" | "bad" | "warn";
  statusLabel: string;
};

export const CURRENCY_ROWS: CurrencyRow[] = [
  {
    id: "day-passenger",
    label: "Day passenger",
    detail: "7 landings / 90 days",
    status: "ok",
    statusLabel: "Current",
  },
  {
    id: "night-passenger",
    label: "Night passenger",
    detail: "1 of 3 landings · 2 more needed",
    status: "bad",
    statusLabel: "Not current",
  },
  {
    id: "instrument",
    label: "Instrument",
    detail: "6 approaches · 1 hold",
    status: "ok",
    statusLabel: "Current",
  },
  {
    id: "medical",
    label: "First class medical",
    detail: "Expires 30 Nov 2026",
    status: "warn",
    statusLabel: "4 months",
  },
  {
    id: "flight-review",
    label: "Flight review",
    detail: "Due 31 Mar 2027",
    status: "ok",
    statusLabel: "Current",
  },
  {
    id: "passport",
    label: "Passport",
    detail: "Expires 19 Jun 2027",
    status: "ok",
    statusLabel: "Current",
  },
];

export type ReadyToInvoiceTrip = {
  id: string;
  client: string;
  route: string;
  amount: string;
  detail: string;
};

export const READY_TO_INVOICE: ReadyToInvoiceTrip[] = [
  {
    id: "trp-0114",
    client: "Sandhill Capital Partners",
    route: "KFXE → KTEB → KFXE · N412TG · 2 days · 21–22 Jul",
    amount: "$2,900",
    detail: "$2,400 rate + $500 exp",
  },
  {
    id: "trp-0113",
    client: "Beacon MRO",
    route: "KLAL → KSGJ · N88CV · ferry · 26 Jul",
    amount: "$1,950",
    detail: "$1,600 rate + $350 exp",
  },
];

export type AttentionItem = {
  id: string;
  label: string;
  detail: string;
  action: string;
};

export const NEEDS_ATTENTION: AttentionItem[] = [
  {
    id: "inv-0041",
    label: "INV-0041 past due",
    detail: "Coastal Jet Mgmt · $3,200 · 34 days",
    action: "Remind",
  },
  {
    id: "unassigned-receipts",
    label: "3 receipts unassigned",
    detail: "Won't be billed or deducted",
    action: "Sort",
  },
  {
    id: "w9-tarrant",
    label: "W-9 outstanding",
    detail: "Tarrant Family Office · sent 18 Jul",
    action: "Resend",
  },
];

export type Kpi = {
  id: string;
  label: string;
  value: string;
  sub: string;
};

export const KPIS: Kpi[] = [
  { id: "unbilled", label: "Unbilled work", value: "$6,850", sub: "2 trips · oldest 11 days" },
  { id: "awaiting", label: "Awaiting payment", value: "$14,200", sub: "3 invoices" },
  { id: "paid", label: "Paid this year", value: "$92,400", sub: "4 clients" },
  { id: "deductible", label: "Deductible expenses", value: "$8,475", sub: "41 receipts filed" },
];
