"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import NextLink from "next/link";
import { LAlert, LButton, LCard, LPill, LSeparator, lButtonClass } from "@/components/ledger";
import { LInput, LSelect } from "@/components/ledger/forms";

import {
  LOGBOOK_VIEW_ROLES,
  LOGBOOK_VIEW_ROLE_LABEL,
  logbookFilterHref,
  logbookFilterIsEmpty,
  logbookFiltersEqual,
  type LogbookFilter,
  type LogbookView,
} from "@/lib/logbook-views";
import type { LogbookViewFormState } from "./views-actions";

/**
 * The saved-view picker and the filter that feeds it.
 *
 * THE FILTER LIVES IN THE URL, not in this component's state, and that is
 * the load-bearing decision here. A filtered logbook is something a pilot
 * bookmarks, sends to themselves, and comes back to after a browser
 * restart; it is also what the browser's back button has to be able to
 * undo. Holding it in React state would break all three and would make a
 * saved view a different kind of thing from a link, when they are exactly
 * the same thing with a name attached. So this component's own state is
 * only the DRAFT — what the pilot has picked but not yet applied — and
 * applying navigates.
 *
 * The pickers below are real native <select>s (LSelect), so unlike the
 * pre-Ledger Radix Select they need no workaround for React 19's
 * post-action form reset — this filter form is never posted anyway
 * (apply() calls router.push, not a server action).
 */

// "any" is a real choice rather than an absence, so it keeps its own
// sentinel rather than collapsing to "".
const ANY = "__any__";

const initialState: LogbookViewFormState = { error: null };

export type TailOption = { tailKey: string; tailNumber: string; archived: boolean };

export default function SavedViews({
  views,
  activeFilter,
  tails,
  typeLabels,
  saveAction,
  deleteAction,
}: {
  views: LogbookView[];
  activeFilter: LogbookFilter;
  tails: TailOption[];
  typeLabels: string[];
  saveAction: (
    state: LogbookViewFormState,
    formData: FormData
  ) => Promise<LogbookViewFormState>;
  deleteAction: (formData: FormData) => Promise<void>;
}) {
  const router = useRouter();

  const [tail, setTail] = useState(activeFilter.tailKey ?? ANY);
  const [type, setType] = useState(activeFilter.typeLabel ?? ANY);
  const [role, setRole] = useState<string>(activeFilter.role ?? ANY);
  const [from, setFrom] = useState(activeFilter.dateFrom ?? "");
  const [to, setTo] = useState(activeFilter.dateTo ?? "");
  /** Set by apply() when the two dates cannot both be true. Cleared by the
   *  next apply and by any change to either date. */
  const [rangeError, setRangeError] = useState<string | null>(null);

  // The URL is the source of truth: when a saved view is clicked, or the
  // back button is pressed, the applied filter changes underneath this
  // component and the draft has to follow it. Without this the pickers
  // would keep showing whatever was last typed while the table below
  // showed something else.
  useEffect(() => {
    setTail(activeFilter.tailKey ?? ANY);
    setType(activeFilter.typeLabel ?? ANY);
    setRole(activeFilter.role ?? ANY);
    setFrom(activeFilter.dateFrom ?? "");
    setTo(activeFilter.dateTo ?? "");
    setRangeError(null);
  }, [activeFilter]);

  const [state, formAction, pending] = useActionState(saveAction, initialState);
  const submitted = state.values;
  const [name, setName] = useState("");
  useEffect(() => {
    if (state.saved) setName("");
    else if (submitted?.name !== undefined) setName(submitted.name);
  }, [state, submitted]);

  const activeIsEmpty = logbookFilterIsEmpty(activeFilter);
  const alreadySaved = views.some((view) =>
    logbookFiltersEqual(view.filter, activeFilter)
  );

  function apply(event: React.FormEvent) {
    event.preventDefault();
    const fromValue = from.trim();
    const toValue = to.trim();
    // AN IMPOSSIBLE RANGE IS REFUSED HERE, IN WORDS. resolveLogbookFilter
    // drops both ends of a reversed range, which is the right behaviour for
    // a hand-edited URL — it fails wide, toward showing more of the record.
    // As the ONLY guard it meant a pilot who mistyped a year watched their
    // whole logbook come back under career totals, both date fields blank
    // themselves, and nothing say why. The resolver is still the last line;
    // this is the sentence it always claimed the form said.
    if (fromValue !== "" && toValue !== "" && fromValue > toValue) {
      setRangeError(
        "That range runs backwards. The From date is after the To date. Swap them and try again."
      );
      return;
    }
    setRangeError(null);
    // Assembled through the same pure helper the saved views and the server
    // both use, so a link built here and a link stored in a view cannot be
    // shaped differently. Blank/any facets are omitted rather than written
    // as empty parameters.
    router.push(
      logbookFilterHref({
        tailKey: tail === ANY ? null : tail,
        typeLabel: type === ANY ? null : type,
        role:
          role === ANY
            ? null
            : (LOGBOOK_VIEW_ROLES.find((value) => value === role) ?? null),
        dateFrom: fromValue === "" ? null : fromValue,
        dateTo: toValue === "" ? null : toValue,
      })
    );
  }

  return (
    <LCard>
      <div className="flex flex-col gap-3">
        {views.length > 0 ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-caption font-bold uppercase text-ink-3">
                Saved views
              </span>
              {views.map((view) => {
                const isActive = logbookFiltersEqual(view.filter, activeFilter);
                return (
                  <div key={view.name} className="flex items-center gap-1">
                    <NextLink
                      href={logbookFilterHref(view.filter)}
                      className={lButtonClassSm(isActive)}
                    >
                      {view.name}
                    </NextLink>
                    {/* Its own tiny form rather than a button inside the
                        filter form: nesting forms is invalid HTML and the
                        delete must not carry the filter's fields. */}
                    <form action={deleteAction}>
                      <input type="hidden" name="name" value={view.name} />
                      <LButton
                        type="submit"
                        variant="quiet"
                        size="sm"
                        className="px-1.5"
                        aria-label={`Delete the saved view ${view.name}`}
                      >
                        <CrossIcon />
                      </LButton>
                    </form>
                  </div>
                );
              })}
            </div>
            <LSeparator className="my-0" />
          </>
        ) : null}

        <form onSubmit={apply}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="flex flex-col gap-1">
              <span id="filter-tail-label" className="text-body-s font-medium text-ink">
                Aircraft
              </span>
              <LSelect aria-labelledby="filter-tail-label" value={tail} onChange={(e) => setTail(e.target.value)}>
                <option value={ANY}>Any aircraft</option>
                {tails.map((option) => (
                  <option key={option.tailKey} value={option.tailKey}>
                    {/* A retired airframe still filters — archiving takes
                        it out of the pickers for NEW work, and its hours
                        are still the pilot's history. Marked rather than
                        hidden. */}
                    {option.archived
                      ? `${option.tailNumber} (retired)`
                      : option.tailNumber}
                  </option>
                ))}
              </LSelect>
            </div>

            <div className="flex flex-col gap-1">
              <span id="filter-type-label" className="text-body-s font-medium text-ink">
                Type
              </span>
              <LSelect aria-labelledby="filter-type-label" value={type} onChange={(e) => setType(e.target.value)}>
                <option value={ANY}>Any type</option>
                {typeLabels.map((label) => (
                  <option key={label} value={label}>
                    {label}
                  </option>
                ))}
              </LSelect>
            </div>

            <div className="flex flex-col gap-1">
              <span id="filter-role-label" className="text-body-s font-medium text-ink">
                Role
              </span>
              <LSelect aria-labelledby="filter-role-label" value={role} onChange={(e) => setRole(e.target.value)}>
                <option value={ANY}>Any role</option>
                {LOGBOOK_VIEW_ROLES.map((value) => (
                  <option key={value} value={value}>
                    {LOGBOOK_VIEW_ROLE_LABEL[value]}
                  </option>
                ))}
              </LSelect>
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="filter-from" className="text-body-s font-medium text-ink">
                From
              </label>
              <LInput
                id="filter-from"
                type="date"
                value={from}
                onChange={(event) => {
                  setFrom(event.target.value);
                  setRangeError(null);
                }}
              />
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="filter-to" className="text-body-s font-medium text-ink">
                To
              </label>
              <LInput
                id="filter-to"
                type="date"
                value={to}
                onChange={(event) => {
                  setTo(event.target.value);
                  setRangeError(null);
                }}
              />
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <LButton type="submit" variant="outline">
              Show these entries
            </LButton>
            {activeIsEmpty ? null : (
              <NextLink href="/logbook" className={lButtonClassGhost()}>
                Clear
              </NextLink>
            )}
          </div>

          {rangeError ? (
            <LAlert tone="warn" className="mt-3 flex items-start gap-2">
              <WarningIcon className="mt-0.5 shrink-0 text-warn" />
              <span>{rangeError}</span>
            </LAlert>
          ) : null}
        </form>

        {activeIsEmpty ? null : (
          <>
            <LSeparator className="my-0" />
            {alreadySaved ? (
              <div className="flex items-center gap-2">
                <LPill tone="neutral">Saved</LPill>
                <span className="text-caption text-ink-3">
                  You already have a saved view for exactly this filter.
                </span>
              </div>
            ) : (
              <form action={formAction}>
                {/* THE APPLIED FILTER, not the draft above: what gets saved
                    is what the pilot is looking at. Re-validated server-side
                    — these are as untrusted as a hand-edited URL. */}
                <input type="hidden" name="tail" value={activeFilter.tailKey ?? ""} />
                <input type="hidden" name="type" value={activeFilter.typeLabel ?? ""} />
                <input type="hidden" name="role" value={activeFilter.role ?? ""} />
                <input type="hidden" name="from" value={activeFilter.dateFrom ?? ""} />
                <input type="hidden" name="to" value={activeFilter.dateTo ?? ""} />
                <div className="flex flex-wrap items-end gap-2">
                  <div className="flex flex-col gap-1">
                    <label htmlFor="view-name" className="text-body-s font-medium text-ink">
                      Save this view as
                    </label>
                    <LInput
                      id="view-name"
                      name="name"
                      placeholder="Citation V, as PIC"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                    />
                  </div>
                  <LButton type="submit" disabled={pending}>
                    {pending ? "Saving…" : "Save view"}
                  </LButton>
                </div>
              </form>
            )}
            {state.error ? (
              <LAlert tone="crit" className="flex items-start gap-2">
                <WarningIcon className="mt-0.5 shrink-0 text-crit" />
                <span>{state.error}</span>
              </LAlert>
            ) : null}
          </>
        )}
      </div>
    </LCard>
  );
}

/* ── Small button-link skins local to this screen ─────────────────────
 * The saved-view chips need a size/active-state combination lButtonClass
 * doesn't have a direct variant for (a small solid-vs-soft toggle) and the
 * "Clear" link needs the quiet ghost treatment — both built from the same
 * button primitive's class list rather than a bespoke one. */
function lButtonClassSm(active: boolean) {
  return lButtonClass({ variant: active ? "primary" : "outline", size: "sm" });
}

function lButtonClassGhost() {
  return lButtonClass({ variant: "quiet", size: "sm" });
}

/* ── Inline icons ──────────────────────────────────────────────────────
 * Ledger screens carry no icon dependency — see components/ledger's own
 * header rule. Defined once here, aria-hidden, stroke="currentColor" so it
 * inherits its caller's tone utility. Same shape as invoices/page.tsx's own
 * WarningIcon. */
function WarningIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M8 2 14.25 13H1.75Z" />
      <path d="M8 6.25v3" />
      <circle cx="8" cy="11.25" r="0.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

function CrossIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M3 3l10 10M13 3 3 13" />
    </svg>
  );
}
