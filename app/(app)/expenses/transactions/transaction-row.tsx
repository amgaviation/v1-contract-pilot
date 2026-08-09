"use client";

import { useState } from "react";
import { Badge, Box, Button, Callout, Flex, Select, Table, Text } from "@/components/ui";
import { formatCents, formatDate } from "@/lib/format";
import { confirmTransaction, ignoreTransaction } from "./actions";

const CATEGORIES = [
  { value: "airline", label: "Airline" },
  { value: "hotel", label: "Hotel" },
  { value: "rental_car", label: "Rental car" },
  { value: "rideshare", label: "Rideshare" },
  { value: "fuel", label: "Fuel" },
  { value: "meals", label: "Meals" },
  { value: "parking", label: "Parking" },
  { value: "other", label: "Other" },
];

const TREATMENTS = [
  { value: "unassigned", label: "Decide later" },
  { value: "rebill", label: "Rebill to the client" },
  { value: "deduct", label: "Keep as a deduction" },
];

const NO_TRIP = "none";

export type TransactionRowData = {
  id: string;
  posted_on: string;
  description: string;
  amount_cents: number;
  bank_account_label: string;
  suggested_category: string | null;
};

export type TripOption = { id: string; label: string };

export default function TransactionRow({ txn, trips }: { txn: TransactionRowData; trips: TripOption[] }) {
  const isExpenseCandidate = txn.amount_cents < 0;
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState(txn.suggested_category ?? "other");
  const [treatment, setTreatment] = useState("unassigned");
  const [tripId, setTripId] = useState(NO_TRIP);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<"confirmed" | "ignored" | null>(null);

  const handleConfirm = async () => {
    setPending(true);
    setError(null);
    const fd = new FormData();
    fd.set("id", txn.id);
    fd.set("category", category);
    fd.set("treatment", treatment);
    fd.set("trip_id", tripId === NO_TRIP ? "" : tripId);
    const result = await confirmTransaction(fd);
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setDone("confirmed");
  };

  const handleIgnore = async () => {
    setPending(true);
    setError(null);
    const fd = new FormData();
    fd.set("id", txn.id);
    const result = await ignoreTransaction(fd);
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setDone("ignored");
  };

  if (done) {
    return (
      <Table.Row>
        <Table.Cell colSpan={5}>
          <Text size="2" color="gray">
            {done === "confirmed" ? "Saved as an expense." : "Dismissed — not an expense."}
          </Text>
        </Table.Cell>
      </Table.Row>
    );
  }

  return (
    <>
      <Table.Row>
        <Table.Cell className="tnum">{formatDate(txn.posted_on)}</Table.Cell>
        <Table.Cell>
          <Flex direction="column">
            <Text>{txn.description}</Text>
            <Text size="1" color="gray">
              {txn.bank_account_label}
            </Text>
          </Flex>
        </Table.Cell>
        <Table.Cell className="tnum">
          <Text color={isExpenseCandidate ? "red" : "green"}>
            {isExpenseCandidate ? "−" : "+"}
            {formatCents(Math.abs(txn.amount_cents))}
          </Text>
        </Table.Cell>
        <Table.Cell>
          {txn.suggested_category ? <Badge color="blue">Suggested: {txn.suggested_category}</Badge> : null}
          {!isExpenseCandidate ? <Badge color="gray">Deposit / payment</Badge> : null}
        </Table.Cell>
        <Table.Cell>
          {isExpenseCandidate ? (
            <Button type="button" size="1" variant="soft" onClick={() => setOpen((v) => !v)}>
              {open ? "Cancel" : "Review"}
            </Button>
          ) : (
            <Button type="button" size="1" variant="soft" onClick={handleIgnore} disabled={pending}>
              Dismiss
            </Button>
          )}
        </Table.Cell>
      </Table.Row>
      {open ? (
        <Table.Row>
          <Table.Cell colSpan={5}>
            <Flex direction="column" gap="3">
              <Flex gap="3" wrap="wrap" align="center">
                <Box>
                  <Text size="1" color="gray">
                    Category
                  </Text>
                  <Select.Root value={category} onValueChange={setCategory}>
                    <Select.Trigger />
                    <Select.Content>
                      {CATEGORIES.map((c) => (
                        <Select.Item key={c.value} value={c.value}>
                          {c.label}
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select.Root>
                </Box>
                <Box>
                  <Text size="1" color="gray">
                    Treatment
                  </Text>
                  <Select.Root value={treatment} onValueChange={setTreatment}>
                    <Select.Trigger />
                    <Select.Content>
                      {TREATMENTS.map((t) => (
                        <Select.Item key={t.value} value={t.value}>
                          {t.label}
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select.Root>
                </Box>
                {treatment === "rebill" ? (
                  <Box>
                    <Text size="1" color="gray">
                      Trip
                    </Text>
                    <Select.Root value={tripId} onValueChange={setTripId}>
                      <Select.Trigger placeholder="Pick a trip" />
                      <Select.Content>
                        <Select.Item value={NO_TRIP}>No trip</Select.Item>
                        {trips.map((t) => (
                          <Select.Item key={t.id} value={t.id}>
                            {t.label}
                          </Select.Item>
                        ))}
                      </Select.Content>
                    </Select.Root>
                  </Box>
                ) : null}
              </Flex>
              {error ? (
                <Callout.Root>
                  <Callout.Text>{error}</Callout.Text>
                </Callout.Root>
              ) : null}
              <Box>
                <Button type="button" onClick={handleConfirm} disabled={pending}>
                  {pending ? "Saving…" : "Confirm as expense"}
                </Button>
              </Box>
            </Flex>
          </Table.Cell>
        </Table.Row>
      ) : null}
    </>
  );
}
