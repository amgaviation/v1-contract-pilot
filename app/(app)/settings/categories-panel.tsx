import { Callout, Card, Flex, Heading, Text } from "@/components/ui";
import EmptyState from "@/components/ui/empty-state";
import {
  CUSTOM_OPTION_DOMAINS,
  DOMAIN_KEYS_ARE_PINNED,
  rowsForDomain,
  type CustomOptionDomain,
  type CustomOptionRow,
} from "@/lib/custom-options";
import CategoryRow from "./category-row";

/**
 * CATEGORIES — the tenant's own words for the three pickers they file
 * work into.
 *
 * "Taxonomy is the tenant's. State machines are ours." Everything on this
 * screen is taxonomy: what an expense category, a trip kind and a
 * document kind are CALLED, what order they appear in, and whether they
 * are still offered. Nothing on this screen is a state machine — an
 * expense's treatment, an invoice's status, a trip's billing state and an
 * invoice line's type are all absent, because triggers branch on them and
 * a tenant-defined string inside one makes billing unverifiable.
 */

const DOMAIN_COPY: Record<
  CustomOptionDomain,
  { title: string; blurb: string; where: string }
> = {
  expense_category: {
    title: "Expense categories",
    blurb:
      "What you file a cost under. Rename any of these to whatever you actually call it — a pilot who files every ride as \"Uber & Lyft\" should see that word, not ours.",
    where: "Shown when you add an expense, and on every expense you have already filed.",
  },
  trip_kind: {
    title: "Trip kinds",
    blurb:
      "What kind of flying a trip is. Repositioning and ferry are kept separate on purpose; rename either if your operators use different words.",
    where: "Shown when you create or edit a trip.",
  },
  document_kind: {
    title: "Document kinds",
    blurb:
      "What a stored document is. These feed the expirations board, so the name you give one is the name that appears when it is coming due.",
    where: "Shown when you add a document, and on your documents list.",
  },
};

export default function CategoriesPanel({
  options,
  canEdit,
  readError = null,
}: {
  options: CustomOptionRow[];
  canEdit: boolean;
  /**
   * The sentence from a FAILED read, or null when the read succeeded.
   * Without it this panel cannot tell "we couldn't read your taxonomy"
   * from "you have none" and states the reassuring one for both — the
   * exact confusion components/ui/empty-state.tsx exists to prevent.
   */
  readError?: string | null;
}) {
  // Whether ANY option on this screen can actually be retired. Every
  // seeded row is is_builtin, custom_options_protect refuses to archive a
  // built-in, and there is deliberately no createCustomOption action
  // (customization-actions.ts's closing comment), so today this is false
  // for every account — and the copy below must not promise a control
  // that renders on no row. It is computed rather than hardcoded so the
  // sentence comes back by itself on the day the add-your-own-key layer
  // lands and the first non-built-in row exists.
  const canRetireAny = options.some((option) => !option.is_builtin);

  return (
    <Flex direction="column" gap="5">
      <Flex direction="column" gap="1">
        <Heading as="h3" size="4">
          Your categories
        </Heading>
      </Flex>

      {/*
        THE ONE THING THIS SCREEN CANNOT DO YET, said plainly rather than
        implied by a missing button.

        pilot.expenses.category, pilot.trips.trip_kind and
        pilot.documents.kind each still carry a CHECK constraint pinning
        them to the built-in keys (see lib/custom-options.ts's header, and
        20260813000000's, which records the decision). A brand-new
        category could be created in this table, but the first record that
        tried to use it would be refused by that CHECK — so an "Add"
        button here would offer something that cannot be saved.

        That is a database change with its own consequences (every report,
        export and ledger mapping keyed off those vocabularies), not a
        side effect of shipping this screen. Until it happens, this panel
        is the rename / reorder / retire layer, and it says so.
      */}
      {readError ? (
        <Callout.Root color="red">
          <Callout.Text>
            {readError} Your categories aren&rsquo;t shown below because we
            couldn&rsquo;t read them — not because you have none. Reload in a moment.
          </Callout.Text>
        </Callout.Root>
      ) : null}

      {CUSTOM_OPTION_DOMAINS.every((domain) => DOMAIN_KEYS_ARE_PINNED[domain]) ? (
        <Callout.Root color="gray">
          <Callout.Text>
            {canRetireAny
              ? "You can rename, reorder and retire any of these. "
              : "You can rename and reorder any of these. Retiring one isn't offered because every option here is a built-in — they're what your existing records are already filed under, so the database refuses to hide them; rename instead, and the new name shows everywhere including on past records. "}
            Adding a brand-new category isn&rsquo;t available yet — the three lists
            themselves are fixed in the database, so a new one couldn&rsquo;t be
            saved onto an expense, trip or document even if this screen offered it.
            Renaming covers most of what people want from it.
          </Callout.Text>
        </Callout.Root>
      ) : null}

      {CUSTOM_OPTION_DOMAINS.map((domain) => {
        const rows = rowsForDomain(options, domain);
        const copy = DOMAIN_COPY[domain];
        return (
          <Flex direction="column" gap="3" key={domain}>
            <Flex direction="column" gap="1">
              <Heading as="h4" size="3">
                {copy.title}
              </Heading>
              <Text size="1" color="gray">
                {copy.where}
                {canRetireAny
                  ? " Retired options stay on the records already filed under them."
                  : ""}
              </Text>
            </Flex>

            {readError ? null : rows.length === 0 ? (
              <Card>
                <EmptyState title="Nothing here yet">
                  These lists are set up automatically for every account, so this one
                  should fill in shortly. Reload in a moment.
                </EmptyState>
              </Card>
            ) : (
              <Flex direction="column" gap="2">
                {rows.map((option, index) => (
                  <CategoryRow
                    key={option.id}
                    option={option}
                    canEdit={canEdit}
                    isFirst={index === 0}
                    isLast={index === rows.length - 1}
                    position={index + 1}
                    total={rows.length}
                  />
                ))}
              </Flex>
            )}
          </Flex>
        );
      })}

      {canEdit ? null : (
        <Text size="1" color="gray">
          Only the account owner can change these lists.
        </Text>
      )}
    </Flex>
  );
}
