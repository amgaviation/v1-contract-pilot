import { Callout, Card, Flex, Heading, Separator, Text } from "@/components/ui";
import { ExclamationTriangleIcon } from "@radix-ui/react-icons";
import type { Database } from "@/lib/supabase/database.types";
import { includesPart135, type ClientOperatingRule } from "@/lib/operating-rule";
import {
  OPERATOR_QUALIFICATION_REQUIREMENTS,
  TYPE_SPECIFIC_REQUIREMENTS,
  PART_135_ONLY_REQUIREMENTS,
  COMPETENCY_CHECK_REQUIREMENT,
  IPC_REQUIREMENT,
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
 * pilot IS on the operator's certificate, and (20260807110000) nothing
 * on it may read as AMG computing a regulatory-compliance VERDICT either
 * — the "Valid through" dates below are a planning aid, not that
 * determination. See the migration's table comment and header.
 *
 * TYPE SPECIFICITY (20260807110000 correction — read the migration
 * header before touching this again): 135.299(a)'s line check is NOT
 * type-specific ("a flight check in one of the types... which that
 * pilot is to fly" — one check covers every type), so it renders as a
 * single fixed row below, same as basic_indoc etc., with an optional,
 * purely informational aircraft-type field. 135.293(b)'s competency
 * check and 135.297's IPC ARE class/type-specific (293(b): class for
 * single-engine non-turbojet airplane, type otherwise; 297(e): "in each
 * type... in rotation" when assigned more than one), so those two are
 * the ones that render as repeatable-by-type sub-lists.
 *
 * PART 91 / PART 135 GATING (20260807130000, closing the regulatory-
 * audit gap): the four Part 135-specific requirements
 * (PART_135_ONLY_REQUIREMENTS — written test, competency check, IPC,
 * line check) are only rendered when this client's operating_rule
 * includes Part 135 (includesPart135() — 'part_135' or 'both';
 * 'unspecified' reads as NOT Part 135, the safe direction — see
 * lib/operating-rule.ts). This is a DISPLAY gate only: the seven
 * requirements with no cited calendar-month reg (basic_indoc through
 * company_manuals/other) are not Part 135-specific and stay visible
 * regardless of operating_rule, exactly as before. The 135.301(a) grace
 * itself is gated separately, at the database (20260807130000's change
 * to pilot.compute_operator_qualification_expiry()) — hiding a row here
 * does not, by itself, change what's stored for it.
 */
export default function OperatorQualificationsPanel({
  clientId,
  clientName,
  clientOperatingRule,
  qualifications,
  loadError,
}: {
  clientId: string;
  clientName: string;
  clientOperatingRule: ClientOperatingRule;
  qualifications: QualificationRow[];
  loadError?: boolean;
}) {
  const byRequirement = new Map<string, QualificationRow[]>();
  for (const q of qualifications) {
    const list = byRequirement.get(q.requirement) ?? [];
    list.push(q);
    byRequirement.set(q.requirement, list);
  }

  const showPart135 = includesPart135(clientOperatingRule);

  const visibleRequirements = OPERATOR_QUALIFICATION_REQUIREMENTS.filter(
    (r) => showPart135 || !PART_135_ONLY_REQUIREMENTS.has(r.value)
  );

  const fixedRequirements = visibleRequirements.filter(
    (r) => !TYPE_SPECIFIC_REQUIREMENTS.has(r.value)
  );

  const typeSpecificSections = visibleRequirements.filter((r) =>
    TYPE_SPECIFIC_REQUIREMENTS.has(r.value)
  );

  const sectionCopy: Record<string, string> = {
    [COMPETENCY_CHECK_REQUIREMENT]:
      "135.293(b) is keyed to class (single-engine airplane, other than turbojet) or type " +
      "(helicopter, multiengine airplane, turbojet airplane, powered-lift) — one competency " +
      `check per class/type you fly for ${clientName}.`,
    [IPC_REQUIREMENT]:
      "135.297(e): if you're assigned more than one type for this operator, your IPC rotates " +
      "through your types (one flight check per 6-month period, not one per type per period). " +
      "Record each check by the type it was flown in — this panel does not compute whether your " +
      "rotation satisfies 297(e); that is on you and your chief pilot to track.",
  };

  return (
    <Card size="3">
      <Flex direction="column" gap="1" mb="3">
        <Heading as="h3" size="4">Operator qualifications</Heading>
        <Text size="2" color="gray">
          What {clientName} has told or shown you about your standing on their certificate —
          training, checks, and program status. This is a record of what you were told, not a
          determination that you are on {clientName}&rsquo;s certificate; only the operator can
          say that. 135.293(a)/(b), 135.297, and 135.299&rsquo;s valid-through dates are computed
          for you from the completion date, including the 135.301(a) one-month-early/one-month-late
          allowance — that computation is a planning aid, not a determination of regulatory
          compliance; you and the operator remain responsible for that. Everything else here is a
          date you enter directly.
        </Text>
        {showPart135 ? null : (
          <Callout.Root color="gray" size="1">
            <Callout.Text>
              {clientName}&rsquo;s operating rule is set to{" "}
              {clientOperatingRule === "unspecified" ? "not yet specified" : "Part 91 only"} on
              the form above, so the Part 135 checks (135.293 written test and competency check,
              135.297 IPC, 135.299 line check) are hidden — those regs bind Part 135 operations
              only. Set the operating rule to Part 135 or Both above if this client ever gives you
              Part 135 work.
            </Callout.Text>
          </Callout.Root>
        )}
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
                typeDesignator={byRequirement.get(req.value)?.[0]?.type_designator ?? ""}
                existing={byRequirement.get(req.value)?.[0] ?? null}
                allowTypeEdit={req.value === LINE_CHECK_REQUIREMENT}
              />
            </div>
          ))}

          {typeSpecificSections.map((req) => {
            const rows = (byRequirement.get(req.value) ?? []).sort((a, b) =>
              a.type_designator.localeCompare(b.type_designator)
            );
            return (
              <div key={req.value}>
                <Separator size="4" my="1" />
                <Text as="div" size="2" weight="medium" mt="2" mb="1">
                  {req.label}
                </Text>
                <Text as="div" size="1" color="gray" mb="2">
                  {sectionCopy[req.value]}
                </Text>

                {rows.map((row) => (
                  <OperatorQualificationRow
                    key={row.id}
                    clientId={clientId}
                    requirement={req.value}
                    label={req.label}
                    typeDesignator={row.type_designator}
                    existing={row}
                    allowDelete
                  />
                ))}

                <Separator size="4" my="1" />
                <OperatorQualificationRow
                  key={`${req.value}-new`}
                  clientId={clientId}
                  requirement={req.value}
                  label={`Add a ${req.label.toLowerCase()}`}
                  existing={null}
                  allowTypeEdit
                />
              </div>
            );
          })}
        </Flex>
      )}
    </Card>
  );
}
