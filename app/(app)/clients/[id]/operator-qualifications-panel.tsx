import { Callout, Card, Flex, Heading, Separator, Text } from "@/components/ui";
import { ExclamationTriangleIcon } from "@radix-ui/react-icons";
import type { Database } from "@/lib/supabase/database.types";
import {
  OPERATOR_QUALIFICATION_REQUIREMENTS,
  LINE_CHECK_REQUIREMENT,
} from "./operator-qualification-kinds";
import OperatorQualificationRow from "./operator-qualification-row";

type QualificationRow = Database["pilot"]["Tables"]["operator_qualifications"]["Row"];

/**
 * Per-client (per-operator) qualification tracking — WHY THIS LIVES ON
 * THE CLIENT DETAIL PAGE RATHER THAN A SETTINGS TAB: the data model keys
 * every row to (account_id, client_id, ...) because a Part 135 pilot's
 * standing is per-OPERATOR, never global (135.293/.297/.299 currency
 * under one certificate says nothing about another). A Settings tab has
 * no client already in scope, so it would need its own client picker
 * before showing anything — extra navigation with no offsetting benefit.
 * The rate-overrides panel just above this one settled the identical
 * question the same way for client_rates, which is also client-keyed;
 * this panel matches that precedent rather than inventing a second one.
 *
 * COPY DISCIPLINE: nothing on this panel may read as AMG determining the
 * pilot IS on the operator's certificate. It records what the pilot has
 * been told/shown by the operator — see the migration's table comment.
 */
export default function OperatorQualificationsPanel({
  clientId,
  clientName,
  qualifications,
  loadError,
}: {
  clientId: string;
  clientName: string;
  qualifications: QualificationRow[];
  loadError?: boolean;
}) {
  const byRequirement = new Map<string, QualificationRow[]>();
  for (const q of qualifications) {
    const list = byRequirement.get(q.requirement) ?? [];
    list.push(q);
    byRequirement.set(q.requirement, list);
  }

  const fixedRequirements = OPERATOR_QUALIFICATION_REQUIREMENTS.filter(
    (r) => r.value !== LINE_CHECK_REQUIREMENT
  );
  const lineChecks = (byRequirement.get(LINE_CHECK_REQUIREMENT) ?? []).sort((a, b) =>
    a.type_designator.localeCompare(b.type_designator)
  );

  return (
    <Card size="3">
      <Flex direction="column" gap="1" mb="3">
        <Heading as="h3" size="4">Operator qualifications</Heading>
        <Text size="2" color="gray">
          What {clientName} has told or shown you about your standing on their certificate —
          training, checks, and program status. This is a record of what you were told, not a
          determination that you are on {clientName}&rsquo;s certificate; only the operator can
          say that. 135.293/135.297/135.299&rsquo;s valid-through dates are computed for you from
          the completion date, including the 135.301(a) one-month-early/one-month-late
          allowance. Everything else here is date you enter directly.
        </Text>
      </Flex>

      {loadError ? (
        <Callout.Root color="red">
          <Callout.Icon>
            <ExclamationTriangleIcon />
          </Callout.Icon>
          <Callout.Text>Couldn&rsquo;t load operator qualifications. Try reloading the page.</Callout.Text>
        </Callout.Root>
      ) : (
        <Flex direction="column">
          {fixedRequirements.map((req, idx) => (
            <div key={req.value}>
              {idx > 0 ? <Separator size="4" my="1" /> : null}
              <OperatorQualificationRow
                clientId={clientId}
                requirement={req.value}
                label={req.label}
                existing={byRequirement.get(req.value)?.[0] ?? null}
              />
            </div>
          ))}

          <Separator size="4" my="1" />

          <Text as="div" size="2" weight="medium" mt="2" mb="1">
            Line checks
          </Text>
          <Text as="div" size="1" color="gray" mb="2">
            135.299(a) is type-specific — one line check per aircraft type you fly for{" "}
            {clientName}.
          </Text>

          {lineChecks.map((row) => (
            <OperatorQualificationRow
              key={row.id}
              clientId={clientId}
              requirement={LINE_CHECK_REQUIREMENT}
              label="Line check"
              typeDesignator={row.type_designator}
              existing={row}
              allowDelete
            />
          ))}

          <Separator size="4" my="1" />
          <OperatorQualificationRow
            key="line-check-new"
            clientId={clientId}
            requirement={LINE_CHECK_REQUIREMENT}
            label="Add a line check"
            existing={null}
            allowTypeEdit
          />
        </Flex>
      )}
    </Card>
  );
}
