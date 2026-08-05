"use client";

import { useActionState, useState, useTransition } from "react";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import Checkbox from "@mui/material/Checkbox";
import MDBox from "@/components/mdpro/MDBox";
import MDTypography from "@/components/mdpro/MDTypography";
import MDButton from "@/components/mdpro/MDButton";
import { formatCents, centsToInput } from "@/lib/format";
import {
  addInvoiceLine,
  addRebillExpenseLine,
  deleteInvoiceLine,
  updateInvoiceLine,
  type LineFormState,
} from "../actions";

export type LineRow = {
  id: string;
  invoice_id: string;
  line_type: "flight_day" | "travel_day" | "per_diem" | "reimbursable_expense" | "cancellation_fee" | "other";
  description: string;
  quantity: number;
  unit_amount_cents: number;
  amount_cents: number;
  taxable: boolean;
  trip_id: string | null;
  expense_id: string | null;
};

export type RebillableExpense = {
  id: string;
  trip_id: string | null;
  category: string;
  vendor: string | null;
  amount_cents: number;
  incurred_on: string;
};

const LINE_TYPE_LABEL: Record<string, string> = {
  flight_day: "Flight day",
  travel_day: "Travel day",
  per_diem: "Per diem",
  reimbursable_expense: "Rebilled expense",
  cancellation_fee: "Cancellation fee",
  other: "Other",
};

const MANUAL_LINE_TYPES = [
  { value: "flight_day", label: "Flight day" },
  { value: "travel_day", label: "Travel day" },
  { value: "per_diem", label: "Per diem" },
  { value: "cancellation_fee", label: "Cancellation fee" },
  { value: "other", label: "Other" },
];

const initialLineState: LineFormState = { error: null };

export default function LinesEditor({
  invoiceId,
  lines,
  editable,
  rebillable,
}: {
  invoiceId: string;
  lines: LineRow[];
  editable: boolean;
  rebillable: RebillableExpense[];
}) {
  if (lines.length === 0 && !editable) {
    return (
      <MDTypography variant="button" color="text" fontWeight="regular">
        No line items.
      </MDTypography>
    );
  }

  return (
    <MDBox>
      <TableContainer sx={{ boxShadow: "none" }}>
        <Table>
          <TableHead sx={{ display: "table-header-group" }}>
            <TableRow>
              {["Type", "Description", "Qty", "Unit", "Amount", "Taxable", ""].map(
                (heading, index) => (
                  <TableCell key={heading || index} align={index >= 2 && index <= 4 ? "right" : "left"}>
                    <MDTypography variant="caption" fontWeight="bold" textTransform="uppercase">
                      {heading}
                    </MDTypography>
                  </TableCell>
                )
              )}
            </TableRow>
          </TableHead>
          <TableBody>
            {lines.map((line) =>
              editable ? (
                <EditableRow key={line.id} invoiceId={invoiceId} line={line} />
              ) : (
                <ReadOnlyRow key={line.id} line={line} />
              )
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {editable ? (
        <>
          {rebillable.length > 0 ? (
            <MDBox mt={3}>
              <MDTypography variant="button" fontWeight="bold">
                Rebillable expenses
              </MDTypography>
              <MDBox mt={1} display="flex" flexDirection="column" gap={1}>
                {rebillable.map((expense) => (
                  <RebillRow key={expense.id} invoiceId={invoiceId} expense={expense} />
                ))}
              </MDBox>
            </MDBox>
          ) : null}

          <MDBox mt={3}>
            <MDTypography variant="button" fontWeight="bold">
              Add a line
            </MDTypography>
            <AddLineForm invoiceId={invoiceId} />
          </MDBox>
        </>
      ) : null}
    </MDBox>
  );
}

function ReadOnlyRow({ line }: { line: LineRow }) {
  return (
    <TableRow>
      <TableCell>
        <MDTypography variant="button" color="text" fontWeight="regular">
          {LINE_TYPE_LABEL[line.line_type]}
        </MDTypography>
      </TableCell>
      <TableCell>
        <MDTypography variant="button" fontWeight="regular">
          {line.description}
        </MDTypography>
      </TableCell>
      <TableCell align="right">
        <MDTypography variant="button" fontWeight="regular">
          {line.quantity}
        </MDTypography>
      </TableCell>
      <TableCell align="right">
        <MDTypography variant="button" fontWeight="regular">
          {formatCents(line.unit_amount_cents)}
        </MDTypography>
      </TableCell>
      <TableCell align="right">
        <MDTypography variant="button" fontWeight="medium">
          {formatCents(line.amount_cents)}
        </MDTypography>
      </TableCell>
      <TableCell>
        <MDTypography variant="button" color="text" fontWeight="regular">
          {line.taxable ? "Yes" : "No"}
        </MDTypography>
      </TableCell>
      <TableCell />
    </TableRow>
  );
}

function EditableRow({ invoiceId, line }: { invoiceId: string; line: LineRow }) {
  const [editing, setEditing] = useState(false);
  const [state, formAction, pending] = useActionState(updateInvoiceLine, initialLineState);
  const [deletePending, startDelete] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);

  if (!editing) {
    return (
      <TableRow>
        <TableCell>
          <MDTypography variant="button" color="text" fontWeight="regular">
            {LINE_TYPE_LABEL[line.line_type]}
          </MDTypography>
        </TableCell>
        <TableCell>
          <MDTypography variant="button" fontWeight="regular">
            {line.description}
          </MDTypography>
        </TableCell>
        <TableCell align="right">{line.quantity}</TableCell>
        <TableCell align="right">{formatCents(line.unit_amount_cents)}</TableCell>
        <TableCell align="right">
          <MDTypography variant="button" fontWeight="medium">
            {formatCents(line.amount_cents)}
          </MDTypography>
        </TableCell>
        <TableCell>{line.taxable ? "Yes" : "No"}</TableCell>
        <TableCell align="right">
          <MDBox display="flex" gap={1} justifyContent="flex-end">
            <MDButton
              variant="text"
              color="info"
              size="small"
              aria-label={`Edit — ${line.description}`}
              onClick={() => setEditing(true)}
            >
              Edit
            </MDButton>
            <MDButton
              variant="text"
              color="error"
              size="small"
              disabled={deletePending}
              aria-label={`Remove — ${line.description}`}
              onClick={() => {
                if (!window.confirm("Remove this line?")) return;
                startDelete(async () => {
                  const result = await deleteInvoiceLine(line.id, invoiceId);
                  setDeleteError(result?.error ?? null);
                });
              }}
            >
              {deletePending ? "Removing…" : "Remove"}
            </MDButton>
          </MDBox>
          {deleteError ? (
            <MDTypography variant="caption" color="error" display="block" role="alert">
              {deleteError}
            </MDTypography>
          ) : null}
        </TableCell>
      </TableRow>
    );
  }

  return (
    <TableRow sx={{ "& td": { verticalAlign: "top" } }}>
      <TableCell colSpan={7}>
        <MDBox component="form" action={formAction} display="flex" gap={1.5} alignItems="flex-start" flexWrap="wrap">
          <input type="hidden" name="id" value={line.id} />
          <input type="hidden" name="invoice_id" value={invoiceId} />
          <TextField
            name="description"
            label="Description"
            defaultValue={line.description}
            size="small"
            sx={{ flex: "1 1 220px" }}
          />
          <TextField
            name="quantity"
            label="Qty"
            defaultValue={String(line.quantity)}
            size="small"
            sx={{ width: 90 }}
          />
          <TextField
            name="unit_amount"
            label="Unit (USD)"
            defaultValue={centsToInput(line.unit_amount_cents)}
            size="small"
            sx={{ width: 120 }}
          />
          <MDBox display="flex" alignItems="center">
            <Checkbox name="taxable" defaultChecked={line.taxable} size="small" />
            <MDTypography variant="caption">Taxable</MDTypography>
          </MDBox>
          <MDBox display="flex" gap={1}>
            <MDButton type="submit" variant="gradient" color="info" size="small" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </MDButton>
            <MDButton
              type="button"
              variant="outlined"
              color="secondary"
              size="small"
              onClick={() => setEditing(false)}
            >
              Cancel
            </MDButton>
          </MDBox>
          {state.error ? (
            <MDTypography variant="caption" color="error" sx={{ width: "100%" }} role="alert">
              {state.error}
            </MDTypography>
          ) : null}
        </MDBox>
      </TableCell>
    </TableRow>
  );
}

function AddLineForm({ invoiceId }: { invoiceId: string }) {
  const [state, formAction, pending] = useActionState(addInvoiceLine, initialLineState);

  return (
    <MDBox
      component="form"
      action={formAction}
      mt={1}
      display="flex"
      gap={1.5}
      alignItems="flex-start"
      flexWrap="wrap"
    >
      <input type="hidden" name="invoice_id" value={invoiceId} />
      <TextField select name="line_type" label="Type" size="small" defaultValue="other" sx={{ width: 160 }}>
        {MANUAL_LINE_TYPES.map((option) => (
          <MenuItem key={option.value} value={option.value}>
            {option.label}
          </MenuItem>
        ))}
      </TextField>
      <TextField name="description" label="Description" size="small" sx={{ flex: "1 1 220px" }} />
      <TextField name="quantity" label="Qty" size="small" defaultValue="1" sx={{ width: 90 }} />
      <TextField name="unit_amount" label="Unit (USD)" size="small" sx={{ width: 120 }} />
      <MDBox display="flex" alignItems="center">
        <Checkbox name="taxable" defaultChecked size="small" />
        <MDTypography variant="caption">Taxable</MDTypography>
      </MDBox>
      <MDButton type="submit" variant="gradient" color="info" size="small" disabled={pending}>
        {pending ? "Adding…" : "Add line"}
      </MDButton>
      {state.error ? (
        <MDTypography variant="caption" color="error" sx={{ width: "100%" }} role="alert">
          {state.error}
        </MDTypography>
      ) : null}
    </MDBox>
  );
}

function RebillRow({
  invoiceId,
  expense,
}: {
  invoiceId: string;
  expense: RebillableExpense;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState(false);

  return (
    <MDBox display="flex" alignItems="center" gap={2}>
      <MDTypography variant="button" color="text" fontWeight="regular" sx={{ flex: 1 }}>
        {expense.category} {expense.vendor ? `— ${expense.vendor}` : ""} ({expense.incurred_on}) ·{" "}
        {formatCents(expense.amount_cents)}
      </MDTypography>
      <MDButton
        variant="outlined"
        color="info"
        size="small"
        disabled={pending || added}
        aria-label={`Add to invoice — ${expense.category}${
          expense.vendor ? ` — ${expense.vendor}` : ""
        } (${expense.incurred_on})`}
        onClick={() => {
          startTransition(async () => {
            const result = await addRebillExpenseLine(invoiceId, expense.id);
            if (result?.error) setError(result.error);
            else setAdded(true);
          });
        }}
      >
        {added ? "Added" : pending ? "Adding…" : "Add to invoice"}
      </MDButton>
      {error ? (
        <MDTypography variant="caption" color="error" role="alert">
          {error}
        </MDTypography>
      ) : null}
    </MDBox>
  );
}
