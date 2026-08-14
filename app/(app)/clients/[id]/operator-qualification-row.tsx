"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { Badge, Box, Button, Flex, Select, Text, TextField } from "@/components/ui";
import { formatDate } from "@/lib/format";
import type { Database } from "@/lib/supabase/database.types";
import {
  STATUS_OPTIONS,
  DERIVED_EXPIRY_REQUIREMENTS,
  OPERATOR_QUALIFICATION_REG_CITE,
  ROTATION_HISTORY_COPY,
} from "./operator-qualification-kinds";
import {
  saveOperatorQualification,
  deleteOperatorQualification,
  type QualificationFormState,
} from "./operator-qualifications-actions";

type QualificationRow = Database["pilot"]["Tables"]["operator_qualifications"]["Row"];

const initialState: QualificationFormState = { error: null };

/**
 * (20260807110000, item G) Whether an `expires_on` calendar date
 * (a plain "YYYY-MM-DD" string, no time component) is already in the
 * past, judged against the PILOT'S OWN LOCAL WALL CLOCK — never
 * `new Date().toISOString()`, which reads UTC. A pilot west of
 * Greenwich at, say, 1800 local on 31 JUL would have `toISOString()`
 * already reporting 1 AUG, flipping a qualification valid through
 * 2026-07-31 to a false-red "expired" badge roughly seven hours before
 * it actually lapses on their own clock — the exact hazard
 * lib/format.ts's parseCalendarDate/formatDate comments describe and
 * avoid for every other date on this screen. Comparing two "YYYY-MM-DD"
 * strings lexicographically against today's LOCAL "YYYY-MM-DD" (built
 * from getFullYear/getMonth/getDate, not toISOString) reads the pilot's
 * own calendar day, same as they'd read it off their phone.
 *
 * Ideally this would defer to pilot.expirations.ladder_stage — the
 * server-side ladder computed against Postgres current_date, which is
 * this codebase's single definition of "due soon" (see
 * app/(app)/documents/page.tsx) — rather than re-deriving red/gray here
 * at all. That requires the page component that loads `qualifications`
 * for this panel to also join pilot.expirations and pass ladder_stage
 * down, and that page (app/(app)/clients/[id]/page.tsx) is outside this
 * fix's file allowlist. This function is the narrowest correct fix
 * available from inside operator-qualification-row.tsx; the ladder-join
 * is the follow-up flagged in the report.
 */
function isPastLocalDate(isoDate: string): boolean {
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, "0");
  const d = String(today.getDate()).padStart(2, "0");
  return isoDate < `${y}-${m}-${d}`;
}

/**
 * One requirement row: either a fixed kind (one per client — every
 * requirement except the two in TYPE_SPECIFIC_REQUIREMENTS) or one
 * instance of a class/type-specific competency check or IPC. `existing`
 * is null for a requirement the pilot hasn't recorded anything against
 * yet — the same insert-or-update branch RateOverrideRow uses for a
 * never-set override.
 */
export default function OperatorQualificationRow({
  clientId,
  requirement,
  label,
  typeDesignator = "",
  existing,
  allowDelete = false,
  allowTypeEdit = false,
  rotationCurrent = true,
}: {
  clientId: string;
  requirement: string;
  label: string;
  /** Fixed '' for every requirement except line_check_135_299 instances. */
  typeDesignator?: string;
  existing: QualificationRow | null;
  /** Only competency-check and IPC per-type rows offer delete
   * (20260807110000 — these are the two TYPE_SPECIFIC_REQUIREMENTS now;
   * the line check reverted to a fixed single row like every other
   * requirement) — see the action's own comment. */
  allowDelete?: boolean;
  /** True for a "add another type/check" blank row (competency check,
   * IPC), where type_designator is a live text field for a NEW row, and
   * also true for the line check's single fixed row (20260807110000),
   * where type_designator is an optional, informational field on an
   * EXISTING row rather than part of what identifies it — see the
   * sync-on-prop-change effect above for why that combination needs its
   * own handling. False everywhere else, where type_designator is a
   * fixed hidden value. */
  allowTypeEdit?: boolean;
  /** H-ipc-per-type fix: whether THIS row's own expires_on should ever
   * drive the red/gray badge below. Defaults true — correct for every
   * requirement except ipc_135_297, where 135.297(e)'s rotation means
   * only the row with the latest expires_on across a client's types is
   * "current" for 297(a)'s window; the panel computes that with
   * currentIpcRotationId() and passes false for every older type row,
   * since an older row's own lapse is the rotation working as designed,
   * not something to flag red. See operator-qualification-kinds.ts.
   *
   * This prop itself stays requirement-agnostic (it's just "is this row
   * the current one"), but the copy it triggers is NOT hardcoded here —
   * it's looked up from ROTATION_HISTORY_COPY[requirement] below, keyed
   * to whichever requirement actually has a rotation clause. That keeps
   * a future rotationCurrent={false} on some other TYPE_SPECIFIC
   * requirement from rendering a 135.297(e) citation it has nothing to
   * do with (REVIEW-ipc problem 6) — it would render that requirement's
   * own entry, or the generic fallback below if none exists yet. */
  rotationCurrent?: boolean;
}) {
  const [state, formAction, pending] = useActionState(saveOperatorQualification, initialState);
  const [deleting, startDelete] = useTransition();
  const [rowError, setRowError] = useState<string | null>(null);
  const [typeInput, setTypeInput] = useState(typeDesignator);
  const [statusValue, setStatusValue] = useState<string>(existing?.status ?? "not_started");
  // isPastLocalDate reads the DEVICE'S wall clock, which the server cannot
  // know at render time — Vercel's SSR pass runs in UTC. Gating on `mounted`
  // makes both the SSR pass and React's first client render agree (always
  // gray, never red, until the client has actually mounted), so there is
  // nothing for hydration to reconcile; the real local-date judgment — and
  // any resulting red badge — only ever appears after mount, once it can
  // be computed from the pilot's own clock rather than the server's.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const derived = DERIVED_EXPIRY_REQUIREMENTS.has(requirement);
  const regCite = OPERATOR_QUALIFICATION_REG_CITE[requirement];

  // (20260807110000) The line check is now a single fixed row whose
  // type_designator is edited IN PLACE rather than only ever created
  // fresh (the only case allowTypeEdit used to cover). A plain
  // `useState(typeDesignator)` only reads its argument on mount, so once
  // a save round-trips through revalidatePath and this row re-renders
  // with a NEW `typeDesignator` prop, local state would keep showing the
  // stale pre-save value. Re-sync whenever the prop actually changes —
  // this fires after a successful save updates `existing`/`typeDesignator`
  // from the server, not on every keystroke (the prop itself doesn't
  // change while the pilot is still typing).
  useEffect(() => {
    setTypeInput(typeDesignator);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeDesignator]);

  const completedValue =
    state.values?.completed_on !== undefined
      ? state.values.completed_on
      : existing?.completed_on ?? "";

  // expires_on is only ever hand-entered for the non-derived kinds (H4) —
  // for the four trigger-derived checks (135.293(a), 135.293(b),
  // 135.297, 135.299 — DERIVED_EXPIRY_REQUIREMENTS) the database always
  // overwrites it, so there is deliberately no input for those; see
  // DERIVED_EXPIRY_REQUIREMENTS and the trigger's own comment.
  const expiresValue =
    state.values?.expires_on !== undefined
      ? state.values.expires_on
      : existing?.expires_on ?? "";

  // The "add another type/check" blank row (allowTypeEdit with no
  // `existing`) keeps a stable key in the parent list across the
  // revalidatePath refresh that follows a successful save, so its local
  // state would otherwise survive that refresh instead of clearing — the
  // one case where React 19's per-dispatch form reset doesn't reach
  // these fields because they're controlled, not uncontrolled. Clear
  // them explicitly once a save on this specific row succeeds.
  //
  // Guarded to `existing === null` (20260807110000): the line check's
  // fixed row also sets allowTypeEdit now (its type is edited in place,
  // not just created fresh — see the sync effect above), and that row
  // must NOT clear back to blank after a successful save, only the
  // never-yet-saved "add a ___" placeholder should.
  useEffect(() => {
    if (allowTypeEdit && existing === null && state.saved) {
      setTypeInput("");
      setStatusValue("not_started");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.saved]);

  return (
    <Flex asChild direction="column" gap="2" py="3">
      <form action={formAction}>
        <input type="hidden" name="client_id" value={clientId} />
        <input type="hidden" name="requirement" value={requirement} />
        <input
          type="hidden"
          name="type_designator"
          value={allowTypeEdit ? typeInput : typeDesignator}
        />
        <input type="hidden" name="status" value={statusValue} />

        <Flex justify="between" align="start" wrap="wrap" gap="3">
          <Box style={{ flex: "1 1 220px" }}>
            <Text as="div" size="2" weight="medium">
              {label}
              {typeDesignator ? `, ${typeDesignator}` : null}
            </Text>
            {regCite ? (
              <Text as="div" size="1" color="gray">
                {regCite}
              </Text>
            ) : null}
          </Box>

          {allowTypeEdit ? (
            <Flex direction="column" gap="1" style={{ flex: "1 1 140px" }}>
              <Text size="1" color="gray">
                Aircraft type
              </Text>
              <TextField.Root
                placeholder="CE-560XL"
                value={typeInput}
                onChange={(e) => setTypeInput(e.target.value)}
              />
            </Flex>
          ) : null}

          <Flex direction="column" gap="1" style={{ flex: "1 1 160px" }}>
            <Text size="1" color="gray">
              Completed on
            </Text>
            <TextField.Root type="date" name="completed_on" defaultValue={completedValue} />
          </Flex>

          <Flex direction="column" gap="1" style={{ flex: "1 1 170px" }}>
            <Text size="1" color="gray">
              Status
            </Text>
            <Select.Root value={statusValue} onValueChange={setStatusValue}>
              <Select.Trigger />
              <Select.Content>
                {STATUS_OPTIONS.map((opt) => (
                  <Select.Item key={opt.value} value={opt.value}>
                    {opt.label}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
          </Flex>

          <Flex direction="column" gap="1" style={{ flex: "1 1 170px" }}>
            <Text size="1" color="gray">
              {derived ? "Valid through (computed)" : "Valid through"}
            </Text>
            {derived ? (
              existing?.expires_on ? (
                <>
                  <Badge
                    color={
                      mounted && rotationCurrent && isPastLocalDate(existing.expires_on)
                        ? "red"
                        : "gray"
                    }
                  >
                    {formatDate(existing.expires_on)}
                  </Badge>
                  <Text size="1" color="gray">
                    {rotationCurrent
                      ? "Planning aid, not a determination of regulatory compliance."
                      : ROTATION_HISTORY_COPY[requirement] ??
                        // Defensive fallback, not expected to render today:
                        // rotationCurrent is only ever false for a
                        // TYPE_SPECIFIC_REQUIREMENTS row with a rotation
                        // clause, and every such requirement has its own
                        // entry in ROTATION_HISTORY_COPY (see that map's
                        // comment). Generic on purpose — it must never
                        // guess a citation for a requirement it wasn't
                        // written for.
                        "Rotation history, not currently judged against the expiry ladder. " +
                          "Planning aid, not a determination of regulatory compliance."}
                  </Text>
                </>
              ) : (
                <Text size="2" color="gray">
                  Set once completed
                </Text>
              )
            ) : (
              <TextField.Root type="date" name="expires_on" defaultValue={expiresValue} />
            )}
          </Flex>

          <Flex direction="column" gap="1" pt="4">
            <Button type="submit" variant="outline" size="1" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </Flex>
        </Flex>

        <Flex direction="column" gap="1" style={{ maxWidth: "480px" }}>
          <Text size="1" color="gray">
            Notes
          </Text>
          <TextField.Root
            name="notes"
            placeholder="Optional"
            defaultValue={state.values?.notes ?? existing?.notes ?? ""}
          />
        </Flex>

        <Box role="alert" aria-live="polite">
          {state.error ? (
            <Text size="1" color="red">
              {state.error}
            </Text>
          ) : state.saved ? (
            <Text size="1" color="green">
              Saved.
            </Text>
          ) : null}
          {rowError ? (
            <Text as="div" size="1" color="red">
              {rowError}
            </Text>
          ) : null}
        </Box>

        {allowDelete && existing ? (
          <Flex>
            <Button
              type="button"
              variant="ghost"
              color="red"
              size="1"
              disabled={deleting}
              onClick={() =>
                startDelete(async () => {
                  setRowError(null);
                  const result = await deleteOperatorQualification(existing.id, clientId);
                  if (result.error) setRowError(result.error);
                })
              }
            >
              {deleting ? "Removing…" : "Remove"}
            </Button>
          </Flex>
        ) : null}
      </form>
    </Flex>
  );
}
