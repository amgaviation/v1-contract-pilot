"use client";

import { useActionState } from "react";
import { LAlert, LButton } from "@/components/ledger";
import { createProductAction, type ProductFormState } from "./actions";

const initialState: ProductFormState = { error: null };

/**
 * A field label + native input, Ledger-skinned. Built locally rather than
 * imported: this worktree's components/ledger has no forms.tsx yet (the
 * Phase 3+ money-surface form primitives haven't landed here), so this is
 * the one call site that needs a labelled text input. Styling matches the
 * documented LEDGER control shape — 15px control text (text-body), which is
 * both the Ledger scale's body size and what clears iOS Safari's 16px
 * focus-zoom threshold — token-only, no arbitrary colors.
 */
function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-body-s font-medium text-ink">
        {label}
      </label>
      {children}
    </div>
  );
}

const inputClass =
  "h-9 w-full rounded-control border border-hair-strong bg-card px-3 text-body text-ink " +
  "placeholder:text-ink-3 focus-visible:outline-2 focus-visible:outline-offset-1 " +
  "focus-visible:outline-accent disabled:opacity-50 disabled:pointer-events-none";

/**
 * The "add a product" form on the sample dashboard.
 *
 * A client component only for the submit state and the inline result message;
 * the work happens in the server action, which is also where validation lives
 * (see its comment on why the browser's copy is only a courtesy).
 */
export default function ProductForm({ disabled }: { disabled: boolean }) {
  const [state, formAction, pending] = useActionState(createProductAction, initialState);

  return (
    <form action={formAction} className="mb-2">
      <div className="flex flex-col gap-3">
        <Field label="Name" htmlFor="sample-product-name">
          <input
            id="sample-product-name"
            name="name"
            placeholder="Charter briefing pack"
            required
            disabled={disabled || pending}
            className={inputClass}
          />
        </Field>

        <Field label="Description" htmlFor="sample-product-description">
          <input
            id="sample-product-description"
            name="description"
            placeholder="What the customer gets"
            disabled={disabled || pending}
            className={inputClass}
          />
        </Field>

        <Field label="Price (USD)" htmlFor="sample-product-price">
          {/* Dollars here, converted to cents in the action — Stripe amounts
              are always in the smallest currency unit. */}
          <input
            id="sample-product-price"
            name="price"
            type="number"
            step="0.01"
            min="0.01"
            placeholder="12.50"
            required
            disabled={disabled || pending}
            className={inputClass}
          />
        </Field>

        <LButton type="submit" disabled={disabled || pending} className="self-start">
          {pending ? "Creating…" : "Create product"}
        </LButton>

        <div className="flex flex-col gap-2" role="status" aria-live="polite">
          {state.error ? <LAlert tone="crit">{state.error}</LAlert> : null}
          {state.created ? (
            <LAlert tone="good">
              Created &ldquo;{state.created}&rdquo; on your Stripe account.
            </LAlert>
          ) : null}
        </div>
      </div>
    </form>
  );
}
