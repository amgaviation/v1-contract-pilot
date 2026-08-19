"use client";

import { useActionState } from "react";
import { LButton, LCard, LSeparator } from "@/components/ledger";
import {
  DEFAULT_INVOICE_TEMPLATE,
  DEFAULT_REMINDER_TEMPLATE,
  INVOICE_PLACEHOLDERS,
  MAX_MESSAGE_TEMPLATE_CHARS,
  REMINDER_PLACEHOLDERS,
  type MessagePlaceholderKey,
} from "@/lib/email/invoice-message";
import { formatCents } from "@/lib/format";
import type { MessageTemplates } from "@/lib/message-templates";
import TemplateEditor from "./template-editor";
import {
  saveMessageTemplates,
  type CustomizationFormState,
} from "./customization-actions";

const initialState: CustomizationFormState = { error: null };

/**
 * The live preview's stand-in invoice. Echoes the SAME figures the
 * placeholders' own descriptions already use as examples (INV-0042,
 * $14,000.00, Sep 10, 2026, 21 days — see INVOICE_PLACEHOLDERS /
 * REMINDER_PLACEHOLDERS) rather than inventing a second set: a pilot who
 * reads "e.g. $14,000.00" under a chip and then sees a different number in
 * the preview would reasonably wonder which one is real. `amount_due`
 * runs through the actual formatter rather than being typed as a string,
 * for the same reason the preview calls applyTemplate at all — so the
 * figure shown is provably what the product would print, not a
 * hand-maintained lookalike that can drift from it.
 */
const INVOICE_SAMPLE_VALUES: Partial<Record<MessagePlaceholderKey, string>> = {
  client_name: "Dana Whitfield",
  invoice_number: "INV-0042",
  amount_due: formatCents(1_400_000),
  due_date: "Sep 10, 2026",
};

const REMINDER_SAMPLE_VALUES: Partial<Record<MessagePlaceholderKey, string>> = {
  ...INVOICE_SAMPLE_VALUES,
  days_overdue: "21 days",
};

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
 * BOTH BOXES ARE TemplateEditor (./template-editor.tsx), NOT A BARE
 * LTextarea WITH `defaultValue` ANY MORE. That used to be the shape here,
 * seeded from the action's echo, with a note explaining why:
 * React 19 resets an uncontrolled form on EVERY dispatch including the
 * rejected one, and a rejected save would otherwise throw away a paragraph
 * the pilot just wrote (settings-form.tsx carries that same note today,
 * for the same reason — its fields are still plain, uncontrolled
 * LInputs). TemplateEditor's textarea is CONTROLLED instead, because the
 * insert chips and the live preview both need the typed text on every
 * keystroke regardless — and once the value lives in React state rather
 * than the DOM, the hazard the echo pattern exists to prevent stops
 * applying to these two fields: a rejected dispatch re-renders
 * TemplateEditor with the same `defaultValue` prop, which `useState`
 * ignores after its first render, so the pilot's text simply stays put.
 * `initial()` below still computes that `defaultValue` from the echo —
 * it is the correct seed for the first paint (or the rare remount) — it
 * is just no longer load-bearing on every dispatch the way its siblings'
 * `defaultValue` still is.
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
    <div className="flex flex-col gap-4">
      <h3 className="text-h3 font-semibold text-ink">Message wording</h3>

      <LCard>
        <form action={formAction}>
          <div className="flex flex-col gap-4">
            <TemplateEditor
              id="invoice_template"
              name="invoice_template"
              label="When you send an invoice"
              disabled={!canEdit}
              builtInTemplate={DEFAULT_INVOICE_TEMPLATE}
              defaultValue={initial("invoice_template")}
              placeholders={INVOICE_PLACEHOLDERS}
              sampleValues={INVOICE_SAMPLE_VALUES}
            >
              <p className="text-caption text-ink-3">
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
              </p>
            </TemplateEditor>

            <LSeparator />

            <TemplateEditor
              id="reminder_template"
              name="reminder_template"
              label="When you send a reminder"
              disabled={!canEdit}
              builtInTemplate={DEFAULT_REMINDER_TEMPLATE}
              defaultValue={initial("reminder_template")}
              placeholders={REMINDER_PLACEHOLDERS}
              sampleValues={REMINDER_SAMPLE_VALUES}
            >
              <p className="text-caption text-ink-3">
                {/* Stated here rather than left to be discovered on the one
                    send where it matters: a template that names how late an
                    invoice is cannot be used on one that isn't late yet, so
                    the built-in wording runs instead. */}
                A reminder sent before the due date uses the built-in wording,
                because {"{{days_overdue}}"} has nothing to say yet.
              </p>
            </TemplateEditor>

            <LSeparator />

            <LengthNote />

            <p className="text-body-s text-ink-3">
              The amount due, payment link, attached receipts, invoice notes
              and your business name are added underneath automatically; they
              have to match the invoice. The subject line is set too, so the
              message is findable by invoice number.
            </p>

            <div role="alert" aria-live="polite">
              {state.error ? (
                <p className="text-caption font-medium text-crit">{state.error}</p>
              ) : state.saved ? (
                <p className="text-caption font-medium text-good">Saved.</p>
              ) : null}
            </div>

            {canEdit ? (
              <div className="flex">
                <LButton type="submit" disabled={pending}>
                  {pending ? "Saving…" : "Save wording"}
                </LButton>
              </div>
            ) : (
              <p className="text-body-s text-ink-3">Only the account owner can change these.</p>
            )}
          </div>
        </form>
      </LCard>
    </div>
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
    <p className="text-body-s text-ink-3">
      Up to {MAX_MESSAGE_TEMPLATE_CHARS.toLocaleString()} characters each.
      Longer than that is refused with a message rather than trimmed for
      you: a bill should never open with a sentence that stops mid-word.
    </p>
  );
}

/*
 * THERE IS DELIBERATELY NO PlaceholderKey COMPONENT IN THIS FILE ANY MORE.
 *
 * It used to render the placeholder list as `{{token}}: description` text
 * under each box — the same information the owner found "too complicated
 * to make users do themselves" (see plan-5-message-wording.md's framing).
 * TemplateEditor's chip row and live preview supersede it entirely: the
 * chip shows the plain-language label and inserts the token itself, and
 * the preview shows what the token becomes, so there is nothing left for a
 * separate spelled-out key to explain. The one invariant PlaceholderKey
 * protected — a screen must never offer a token the server does not fill
 * in — is now TemplateEditor's own, by construction: its chips are
 * rendered from the same `placeholders` array passed in here
 * (INVOICE_PLACEHOLDERS / REMINDER_PLACEHOLDERS, lib/email/invoice-message.ts),
 * never retyped.
 */
