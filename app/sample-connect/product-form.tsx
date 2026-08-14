"use client";

import { useActionState } from "react";
import { Button, Callout, Flex, Text, TextField } from "@/components/ui";
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
    <form action={formAction}>
      <Flex direction="column" gap="3">
        <Flex direction="column" gap="1">
          <Text as="label" size="1" color="gray" htmlFor="sample-product-name">
            Name
          </Text>
          <TextField.Root
            id="sample-product-name"
            name="name"
            placeholder="Charter briefing pack"
            required
            disabled={disabled || pending}
          />
        </Flex>

        <Flex direction="column" gap="1">
          <Text as="label" size="1" color="gray" htmlFor="sample-product-description">
            Description
          </Text>
          <TextField.Root
            id="sample-product-description"
            name="description"
            placeholder="What the customer gets"
            disabled={disabled || pending}
          />
        </Flex>

        <Flex direction="column" gap="1">
          <Text as="label" size="1" color="gray" htmlFor="sample-product-price">
            Price (USD)
          </Text>
          {/* Dollars here, converted to cents in the action — Stripe amounts
              are always in the smallest currency unit. */}
          <TextField.Root
            id="sample-product-price"
            name="price"
            type="number"
            step="0.01"
            min="0.01"
            placeholder="12.50"
            required
            disabled={disabled || pending}
          />
        </Flex>

        <Button type="submit" disabled={disabled || pending}>
          {pending ? "Creating…" : "Create product"}
        </Button>

        <Flex direction="column" gap="2" role="status" aria-live="polite">
          {state.error ? (
            <Callout.Root color="red" size="1">
              <Callout.Text>{state.error}</Callout.Text>
            </Callout.Root>
          ) : null}
          {state.created ? (
            <Callout.Root color="green" size="1">
              <Callout.Text>Created &ldquo;{state.created}&rdquo; on your Stripe account.</Callout.Text>
            </Callout.Root>
          ) : null}
        </Flex>
      </Flex>
    </form>
  );
}
