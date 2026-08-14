"use client";

import * as React from "react";
import { Flex, Stack } from "@/components/ds/layout";
import { Text } from "@/components/ds/type";
import { Button, Panel } from "@/components/ds/surface";
import { ConfirmDialog, Dialog } from "@/components/ds/dialog";
import { Tabs } from "@/components/ds/tabs";

/**
 * The two primitives with behaviour, exercised on the specimen sheet so the
 * dialog's focus handling and the tablist's roving tabindex are things you
 * can actually try rather than things a comment claims.
 */
export function InteractiveSpecimens() {
  const [plain, setPlain] = React.useState(false);
  const [confirm, setConfirm] = React.useState(false);
  const [tab, setTab] = React.useState("business");

  return (
    <Stack gap="4">
      <Panel title="Dialog" aside={<Text size="1" tone="faint">native &lt;dialog&gt; — Esc, focus trap, top layer</Text>}>
        <Flex gap="2" wrap="wrap">
          <Button onClick={() => setPlain(true)}>Open dialog</Button>
          <Button variant="danger" onClick={() => setConfirm(true)}>
            Delete trip…
          </Button>
        </Flex>

        <Dialog
          open={plain}
          onOpenChange={setPlain}
          title="Send invoice INV-2044"
          description={
            <Text size="2" tone="muted">
              The client receives a link to view and pay. You can still edit
              the invoice until it is paid.
            </Text>
          }
          footer={
            <>
              <Button variant="quiet" onClick={() => setPlain(false)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={() => setPlain(false)}>
                Send invoice
              </Button>
            </>
          }
        />

        <ConfirmDialog
          open={confirm}
          onOpenChange={setConfirm}
          title="Delete this trip?"
          description={
            <Text size="2" tone="muted">
              TRP-1042 has 3 day records and 4 attached expenses. Deleting it
              releases those expenses back to the unassigned queue. This cannot
              be undone.
            </Text>
          }
          confirmLabel="Delete trip"
          onConfirm={() => setConfirm(false)}
        />
      </Panel>

      <Panel title="Tabs" aside={<Text size="1" tone="faint">roving tabindex — arrows, Home, End</Text>}>
        <Tabs
          label="Settings sections"
          value={tab}
          onValueChange={setTab}
          items={[
            { value: "business", label: "Business" },
            { value: "day-types", label: "Day types" },
            { value: "categories", label: "Categories" },
            { value: "appearance", label: "Appearance" },
          ]}
        >
          <Text as="p" size="2" tone="muted" mt="3">
            Panel content for <Text weight="semibold">{tab}</Text>.
          </Text>
        </Tabs>
      </Panel>
    </Stack>
  );
}
