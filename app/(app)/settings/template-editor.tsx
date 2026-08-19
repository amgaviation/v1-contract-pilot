"use client";

import * as React from "react";
import { flushSync } from "react-dom";
import { LButton } from "@/components/ledger";
import { LTextarea } from "@/components/ledger/forms";
import { cn } from "@/lib/ledger/cn";
import {
  applyTemplate,
  type MessagePlaceholder,
  type MessagePlaceholderKey,
} from "@/lib/email/invoice-message";
import { insertToken, messageTemplateProblem } from "@/lib/message-templates";

/**
 * ONE TEMPLATE BOX: insert chips, a live preview, instant validation.
 *
 * WHY NOT DRAG-AND-DROP. The owner's own framing was "make it easier —
 * drag and drop or a dropdown" for a pilot who finds `{{amount_due}}`
 * intimidating. Drag-and-drop is the wrong tool for inserting a short
 * token into running inline text: it barely works with a mouse over a
 * three-row box, it does not work with a thumb on a phone (this product's
 * pilots bill from ramps and FBOs, not desks), and a screen-reader user
 * cannot perform a drag at all. A ROW OF BUTTONS that insert at the caret
 * is the same idea — pick a fact by its name, not its syntax — with none
 * of that: it is a `<button>`, every input method already knows how to
 * activate one. The LIVE PREVIEW is what actually retires the need to
 * mentally expand a token: a pilot never has to hold "due {{due_date}} ="
 * "due Sep 10, 2026" in their head, because the box under the textarea
 * already says it.
 *
 * WHAT RUNS ON THE CLIENT, AND WHY THAT IS SAFE. `applyTemplate` and
 * `messageTemplateProblem` are the SAME pure functions
 * app/(app)/settings/customization-actions.ts calls to validate and the
 * SAME one lib/email/invoice-message.ts calls to render a real send — nothing
 * about the storage contract or the validation rule changes by also calling
 * them here. This component decides nothing; it previews what the server
 * would decide, one keystroke ahead of a Save.
 *
 * CONTROLLED, DELIBERATELY — the one field type in app/(app)/settings that
 * is. Every sibling form in this directory (settings-form.tsx,
 * message-templates-panel.tsx's own header, until this component existed)
 * uses `defaultValue` + the action's echoed value, with a shared comment
 * explaining why: React 19 resets an UNCONTROLLED form on every
 * useActionState dispatch, rejected submits included, and without the echo
 * a typo in one field would blank a paragraph the pilot just wrote in
 * another. That hazard is specifically about the DOM owning the value and
 * React discarding it. Here the value has to be reactive on every
 * keystroke anyway — the preview and the instant validation both read it
 * live — so the box is state-controlled from the start, and the hazard
 * the echo pattern defends against does not apply: a rejected dispatch
 * re-renders this component with the same `defaultValue` prop, which
 * `useState` ignores after the first render, so the pilot's typed text
 * simply stays exactly where React already had it. `defaultValue` here is
 * only ever a MOUNT-time seed (first paint, or the rare remount), never a
 * per-dispatch recovery value the way its siblings' `defaultValue` is.
 */
export default function TemplateEditor({
  id,
  name,
  label,
  disabled,
  builtInTemplate,
  defaultValue,
  placeholders,
  sampleValues,
  children,
}: {
  id: string;
  name: string;
  label: string;
  disabled: boolean;
  /**
   * Both the textarea's `placeholder` AND the preview's source when the
   * box is empty. One string plays both roles because they have to agree:
   * the ghosted text a pilot sees in an empty box is exactly the sentence
   * the preview renders for it, so there is exactly one built-in sentence
   * to keep in sync here, never two that could drift apart.
   */
  builtInTemplate: string;
  defaultValue: string;
  placeholders: readonly MessagePlaceholder[];
  sampleValues: Partial<Record<MessagePlaceholderKey, string>>;
  /** The honesty footnote for this box. message-templates-panel.tsx owns
   *  the words; this component only owns where they render. */
  children?: React.ReactNode;
}) {
  const [text, setText] = React.useState(defaultValue);
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);

  /**
   * Insert `token` at the caret (or over the current selection) and put
   * the caret back right after it.
   *
   * `flushSync` IS LOAD-BEARING, not a stylistic choice. `setText` alone
   * schedules a re-render; the textarea's DOM value would still be the OLD
   * text at the moment `setSelectionRange` runs on the next line, which
   * clamps the caret against the wrong (shorter) length and lands it
   * somewhere the pilot did not click. Wrapping the state update in
   * `flushSync` forces React to commit the new value to the DOM
   * synchronously, before this function moves on, so the box on screen
   * already carries `nextText` by the time the caret is set against it.
   */
  function handleInsert(token: string) {
    const el = textareaRef.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const { text: nextText, caret } = insertToken(text, start, end, token);
    flushSync(() => setText(nextText));
    el?.focus();
    el?.setSelectionRange(caret, caret);
  }

  // What the server would do with this box right now, computed the same
  // way saveMessageTemplates computes it: trim first (a template of pure
  // whitespace is the empty template), then the same total ordering of
  // cases applyTemplate/messageTemplateProblem impose everywhere else.
  const trimmed = text.trim();

  // Declared as a function, not a value, so it is only ever evaluated on
  // the branches that need it — cheap either way for a one-line template,
  // but it is also the one fallback every branch below can reach for
  // without re-deriving it.
  function builtInPreview(): string {
    // applyTemplate declining the product's OWN default template is not a
    // real-world case (every placeholder it names has a sample value
    // supplied below) — but "total" is cheaper to keep true than to prove,
    // so the raw sentence is the last-resort floor rather than letting a
    // hypothetical null reach the screen as literally nothing.
    return applyTemplate(builtInTemplate, sampleValues, placeholders) ?? builtInTemplate;
  }

  let previewText: string;
  let previewIsProblem = false;
  if (trimmed === "") {
    // An empty box stores null and means "use the built-in wording" (see
    // message-templates-panel.tsx's header) — so the preview of an empty
    // box has to be the built-in wording too, not a blank rectangle.
    previewText = builtInPreview();
  } else {
    const problem = messageTemplateProblem(trimmed, placeholders);
    if (problem !== null) {
      // The server's own sentence, verbatim — the pilot reads the exact
      // words a rejected Save would show, before they ever click it.
      previewText = problem;
      previewIsProblem = true;
    } else {
      // A template that PASSES validation can still decline at apply time
      // if a placeholder it names has no sample value here — cannot
      // happen with the full sample sets this panel supplies (every key
      // both PLACEHOLDERS arrays allow has a sample value), kept as a
      // fallback rather than asserted away so a placeholder added to one
      // array without its sample value fails soft, in the preview, and
      // not as a thrown error.
      previewText = applyTemplate(trimmed, sampleValues, placeholders) ?? builtInPreview();
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-body-s font-medium text-ink">
        {label}
      </label>
      {/* NO maxLength — see the note above LengthNote in
          message-templates-panel.tsx. */}
      <LTextarea
        id={id}
        name={name}
        rows={3}
        disabled={disabled}
        placeholder={builtInTemplate}
        value={text}
        onChange={(event) => setText(event.target.value)}
        ref={textareaRef}
      />

      <div className="flex flex-wrap gap-2">
        {placeholders.map((placeholder) => (
          <LButton
            key={placeholder.key}
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            aria-label={`${placeholder.label}. Inserts ${placeholder.token}.`}
            onClick={() => handleInsert(placeholder.token)}
          >
            {placeholder.label}
          </LButton>
        ))}
      </div>
      <p className="text-caption text-ink-3">
        Select a fact to add it. Each message fills it in from the invoice it
        is about.
      </p>

      {children}

      <div className="flex flex-col gap-1.5">
        <p className="text-caption font-semibold text-ink-3">
          Preview, with example figures
        </p>
        {/* aria-live, not role="alert": this updates on every keystroke and
            most of those updates are not an error — the caption-shift for
            an error only matters below in the text-crit branch, and
            "polite" is enough for a screen reader to pick that change up
            without interrupting whatever the pilot is doing mid-type. */}
        <div
          aria-live="polite"
          className={cn(
            "whitespace-pre-wrap rounded-control bg-sunk p-3 text-body-s",
            previewIsProblem ? "text-crit" : "text-ink-2"
          )}
        >
          {previewText}
        </div>
      </div>
    </div>
  );
}
