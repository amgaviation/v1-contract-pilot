"use client";

import { useActionState } from "react";
import { LAlert, LButton } from "@/components/ledger";
import { LField, LInput } from "@/components/ledger/forms";
import { createProductAction, type ProductFormState } from "./actions";

const initialState: ProductFormState = { error: null };

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
        <LField label="Name" htmlFor="sample-product-name">
          <LInput
            id="sample-product-name"
            name="name"
            placeholder="Charter briefing pack"
            required
            disabled={disabled || pending}
          />
        </LField>

        <LField label="Description" htmlFor="sample-product-description">
          <LInput
            id="sample-product-description"
            name="description"
            placeholder="What the customer gets"
            disabled={disabled || pending}
          />
        </LField>

        <LField label="Price (USD)" htmlFor="sample-product-price">
          {/* Dollars here, converted to cents in the action — Stripe amounts
              are always in the smallest currency unit. */}
          <LInput
            id="sample-product-price"
            name="price"
            type="number"
            step="0.01"
            min="0.01"
            placeholder="12.50"
            required
            disabled={disabled || pending}
          />
        </LField>

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
