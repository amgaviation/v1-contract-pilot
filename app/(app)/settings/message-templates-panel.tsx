"use client";

import { useActionState } from "react";
import {
  Box,
  Button,
  Card,
  Code,
  Flex,
  Heading,
  Separator,
  Text,
  TextArea,
} from "@/components/ui";
import {
  DEFAULT_INVOICE_TEMPLATE,
  DEFAULT_REMINDER_TEMPLATE,
  INVOICE_PLACEHOLDERS,
  MAX_MESSAGE_TEMPLATE_CHARS,
  REMINDER_PLACEHOLDERS,
  type MessagePlaceholder,
} from "@/lib/email/invoice-message";
import type { MessageTemplates } from "@/lib/message-templates";
import {
  saveMessageTemplates,
  type CustomizationFormState,
} from "./customization-actions";

const initialState: CustomizationFormState = { error: null };

/**
 * MESSAGE WORDING — the opening line of the mail a client receives, saved
 * once and reused on every send.
 *
 * WHAT THIS PANEL IS CAREFUL TO PROMISE. It edits ONE SENTENCE. Everything
 * else in those messages — the balance, the part-payment reconciliation,
 * the receipt count, the payment link, the invoice's own notes, the
 * sign-off in the pilot's business name — is a statement of fact about a
 * particular invoice and is not editable from here, because a bill whose
 * wording can contradict its own figures is worse than a bill with fixed
 * wording. The copy below says so plainly rather than letting a pilot
 * discover it by opening the box and finding one sentence in it.
 *
 * THE BUILT-IN WORDING IS THE `placeholder` ATTRIBUTE, not a pre-filled
 * value, and that is the whole zero-config story in one prop: an empty box
 * SHOWS what the product will say, and an empty box STORES null, which
 * means "say exactly that". A pre-filled value would look identical and
 * behave differently — every account that opened this screen once would
 * have a stored template pinning today's sentence forever, so a future
 * improvement to the built-in copy would reach nobody. Clearing the box is
 * therefore also the reset control, which is why there isn't one.
 *
 * Uncontrolled fields with `defaultValue`, seeded from the action's echo:
 * React 19 resets an uncontrolled form on EVERY dispatch including the
 * rejected one, and a rejected save here would otherwise throw away a
 * paragraph the pilot just wrote (settings-form.tsx carries the same note
 * for the same reason).
 */
export default function MessageTemplatesPanel({
  templates,
  canEdit,
}: {
  templates: MessageTemplates;
  canEdit: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    saveMessageTemplates,
    initialState
  );

  const submitted = state.values;
  const initial = (key: "invoice_template" | "reminder_template") => {
    const echoed = submitted?.[key];
    if (echoed !== undefined) return echoed;
    const stored =
      key === "invoice_template" ? templates.invoice : templates.reminder;
    return stored ?? "";
  };

  return (
    <Flex direction="column" gap="4">
      <Flex direction="column" gap="1">
        <Heading as="h3" size="4">
          Message wording
        </Heading>
        <Text size="2" color="gray">
          The opening line of the emails your clients receive, saved once and
          reused every time. Leave a box empty to use the wording shown in it.
        </Text>
      </Flex>

      <Card>
        <form action={formAction}>
          <Flex direction="column" gap="4" p="1">
            <Flex direction="column" gap="1">
              <Text as="label" size="1" weight="medium" htmlFor="invoice_template">
                When you send an invoice
              </Text>
              {/* NO maxLength — see the note above LengthNote below. */}
              <TextArea
                id="invoice_template"
                name="invoice_template"
                rows={3}
                disabled={!canEdit}
                placeholder={DEFAULT_INVOICE_TEMPLATE}
                defaultValue={initial("invoice_template")}
              />
              <PlaceholderKey placeholders={INVOICE_PLACEHOLDERS} />
              <Text size="1" color="gray">
                {/* The invoice-side twin of the {{days_overdue}} note under
                    the reminder box. {{due_date}} is the one placeholder an
                    otherwise-valid template can name that a real invoice may
                    not be able to supply — a pilot who bills on receipt sets
                    no due date — and applyTemplate declines the whole
                    template rather than printing "due ." Stated here for the
                    same reason as its twin: otherwise it is discovered on
                    the one send where it matters, if at all. */}
                An invoice with no due date uses the built-in wording,
                because {"{{due_date}}"} has nothing to fill in.
              </Text>
            </Flex>

            <Separator size="4" />

            <Flex direction="column" gap="1">
              <Text as="label" size="1" weight="medium" htmlFor="reminder_template">
                When you send a reminder
              </Text>
              {/* NO maxLength — see the note above LengthNote below. */}
              <TextArea
                id="reminder_template"
                name="reminder_template"
                rows={3}
                disabled={!canEdit}
                placeholder={DEFAULT_REMINDER_TEMPLATE}
                defaultValue={initial("reminder_template")}
              />
              <PlaceholderKey placeholders={REMINDER_PLACEHOLDERS} />
              <Text size="1" color="gray">
                {/* Stated here rather than left to be discovered on the one
                    send where it matters: a template that names how late an
                    invoice is cannot be used on one that isn't late yet, so
                    the built-in wording runs instead. */}
                A reminder sent before the due date uses the built-in wording,
                because {"{{days_overdue}}"} has nothing to say yet.
              </Text>
            </Flex>

            <Separator size="4" />

            <LengthNote />

            <Text size="1" color="gray">
              The amount due, the payment link, any receipts attached, your
              invoice notes and your business name are added automatically
              underneath, and can&rsquo;t be edited here — they have to match
              the invoice. The subject line is set for you too, so your client
              can find the message by invoice number.
            </Text>

            <div role="alert" aria-live="polite">
              {state.error ? (
                <Text size="1" color="red">
                  {state.error}
                </Text>
              ) : state.saved ? (
                <Text size="1" color="green">
                  Saved.
                </Text>
              ) : null}
            </div>

            {canEdit ? (
              <Flex>
                <Button type="submit" disabled={pending}>
                  {pending ? "Saving…" : "Save wording"}
                </Button>
              </Flex>
            ) : (
              <Text size="1" color="gray">
                Only the account owner can change these.
              </Text>
            )}
          </Flex>
        </form>
      </Card>
    </Flex>
  );
}

/**
 * THE LENGTH BOUND, STATED — AND DELIBERATELY NOT ENFORCED BY `maxLength`.
 *
 * Both boxes above carried `maxLength={MAX_MESSAGE_TEMPLATE_CHARS}`, which
 * looks like a guard and behaves like a saboteur: a browser SILENTLY drops
 * everything past the limit when text is pasted, with no event, no message
 * and — in a 3-row box on a phone — the cut end scrolled out of view. The
 * pilot then saves a sentence that stops mid-word, and it passes validation
 * precisely because the truncation already happened. That is the exact
 * repair lib/message-templates.ts's normalizeOne refuses to perform
 * ("REJECTION IS ALWAYS null, NEVER A REPAIR"), performed by the browser
 * before the server ever gets a chance to refuse the whole thing.
 *
 * Without it, an over-long paste reaches saveMessageTemplates, which
 * refuses it with messageTemplateProblem's named sentence and echoes the
 * text straight back into the box (see `initial` above), so nothing the
 * pilot wrote is lost and they are told what to fix. The bound is stated
 * here so it is knowable in advance rather than only on rejection.
 */
function LengthNote() {
  return (
    <Text size="1" color="gray">
      Up to {MAX_MESSAGE_TEMPLATE_CHARS.toLocaleString()} characters each.
      Longer than that is refused with a message rather than trimmed for
      you — a bill should never open with a sentence that stops mid-word.
    </Text>
  );
}

/**
 * The placeholders, spelled exactly as they must be typed.
 *
 * Rendered from the same list the SUBSTITUTER uses
 * (lib/email/invoice-message.ts), never retyped here — a screen that
 * offers a token the server does not fill in would produce a client-facing
 * message with `{{whatever}}` in it, which is the single worst outcome
 * this feature can have.
 */
function PlaceholderKey({
  placeholders,
}: {
  placeholders: readonly MessagePlaceholder[];
}) {
  return (
    <Box mt="1">
      <Flex direction="column" gap="1">
        {placeholders.map((placeholder) => (
          <Text as="div" size="1" color="gray" key={placeholder.key}>
            <Code variant="ghost">{placeholder.token}</Code> —{" "}
            {placeholder.description}
          </Text>
        ))}
      </Flex>
    </Box>
  );
}
