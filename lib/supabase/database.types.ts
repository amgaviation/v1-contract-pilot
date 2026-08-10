/**
 * Hand-authored from the LIVE schema of the "V1 Pilot" Supabase project
 * (igbeahtixmbanjdyqgwo) — not a placeholder, but also not
 * machine-generated yet.
 *
 * `supabase gen types` currently returns this schema empty, because
 * `pilot` is not yet in the project's exposed API schemas (Project
 * Settings → API Settings → Exposed schemas, hosted-project setting,
 * separate from supabase/config.toml's local-CLI equivalent — no tool in
 * this session's toolset can set it, so it's a manual step). Once that's
 * done, regenerate for real and this file becomes machine-authored:
 *
 *   supabase gen types typescript --project-id igbeahtixmbanjdyqgwo \
 *     --schema pilot > lib/supabase/database.types.ts
 *
 * Until then, keep this in lockstep with supabase/migrations/*.sql by
 * hand. Covers, as of the migration filenames below:
 *   20260802190437_pilot_schema_tenancy.sql           (accounts, account_members)
 *   20260805070000_phase3_clients_trips_expenses.sql  (clients..documents, expirations)
 *   20260805090000_phase5_invoices.sql                (invoices, invoice_lines, ...)
 *   20260807000000_phase9_day_types_and_trip_days.sql (day_types, trip_days,
 *                                                      client_rates, +3 clients cols)
 *   20260807020000_phase9_review_fixes.sql            (trip_days.quantity,
 *                                                      pilot.trip_committed_invoice)
 *   20260807040000_client_minimum_basis.sql           (clients.minimum_basis,
 *                                                      guarantee_periods)
 *   20260807070000_trip_day_units_away_cancel.sql      (day_types.default_units,
 *                                                      trip_days.units/away,
 *                                                      trips.canceled_at/
 *                                                      cancellation_notice_from)
 *   20260807140000_approach_conditions.sql            (documents.kind +
 *                                                      'pic_proficiency_check';
 *                                                      logbook_entries.approach_condition
 *                                                      is NOT covered here —
 *                                                      logbook_entries stays
 *                                                      out of this file per
 *                                                      app/(app)/logbook/db.ts's
 *                                                      header comment)
 *   20260809020000_mileage.sql                        (mileage_rates,
 *                                                      mileage_entries)
 *   20260809030000_recurring_invoices.sql             (recurring_invoice_schedules,
 *                                                      recurring_invoice_generations)
 *   20260809040000_connect_payments.sql               (invoices.stripe_payment_link_*,
 *                                                      connect_account_link/unlink)
 *   20260809060000_invoice_public_share.sql           (invoice_shares, invoice_public)
 *   20260809070000_bank_transactions.sql              (bank_accounts,
 *                                                      bank_import_batches,
 *                                                      bank_source_files,
 *                                                      bank_transactions)
 *   20260810010000_connect_link_hardening.sql         (connect_oauth_state_begin,
 *                                                      connect_account_link's new
 *                                                      signature,
 *                                                      invoices.stripe_payment_link_amount_cents)
 */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  pilot: {
    Tables: {
      accounts: {
        Row: {
          id: string;
          kind: "solo" | "business";
          legal_name: string;
          address_line1: string | null;
          address_line2: string | null;
          city: string | null;
          state: string | null;
          postal_code: string | null;
          country: string | null;
          logo_url: string | null;
          plan: "solo" | "business" | null;
          seat_count: number;
          stripe_customer_id: string | null;
          stripe_subscription_id: string | null;
          trial_ends_at: string | null;
          status:
            | "trialing"
            | "active"
            | "past_due"
            | "canceled"
            | "unpaid"
            | "incomplete"
            | "incomplete_expired"
            | "paused";
          connect_account_id: string | null;
          invoice_prefix: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          kind: "solo" | "business";
          legal_name: string;
          address_line1?: string | null;
          address_line2?: string | null;
          city?: string | null;
          state?: string | null;
          postal_code?: string | null;
          country?: string | null;
          logo_url?: string | null;
          plan?: "solo" | "business" | null;
          seat_count?: number;
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
          trial_ends_at?: string | null;
          status?:
            | "trialing"
            | "active"
            | "past_due"
            | "canceled"
            | "unpaid"
            | "incomplete"
            | "incomplete_expired"
            | "paused";
          connect_account_id?: string | null;
          invoice_prefix?: string;
          created_at?: string;
          updated_at?: string;
        };
        // Client-side (authenticated role) UPDATE is column-restricted at
        // the database grant — see the migration. This Update type is
        // intentionally NOT narrowed to match: it describes the shape of
        // the row, not who may write which column. A write to a withheld
        // column fails at the database (grant denial or a protect
        // trigger), not at the type layer — narrowing here would just
        // hide that enforcement exists rather than duplicate it. Same
        // policy for every Update type below.
        Update: {
          id?: string;
          kind?: "solo" | "business";
          legal_name?: string;
          address_line1?: string | null;
          address_line2?: string | null;
          city?: string | null;
          state?: string | null;
          postal_code?: string | null;
          country?: string | null;
          logo_url?: string | null;
          plan?: "solo" | "business" | null;
          seat_count?: number;
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
          trial_ends_at?: string | null;
          status?:
            | "trialing"
            | "active"
            | "past_due"
            | "canceled"
            | "unpaid"
            | "incomplete"
            | "incomplete_expired"
            | "paused";
          connect_account_id?: string | null;
          invoice_prefix?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      account_members: {
        Row: {
          id: string;
          account_id: string;
          user_id: string;
          role: "owner" | "member" | "bookkeeper";
          created_at: string;
        };
        Insert: {
          id?: string;
          account_id: string;
          user_id: string;
          role: "owner" | "member" | "bookkeeper";
          created_at?: string;
        };
        Update: {
          id?: string;
          account_id?: string;
          user_id?: string;
          role?: "owner" | "member" | "bookkeeper";
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "account_members_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "accounts";
            referencedColumns: ["id"];
          },
        ];
      };
      clients: {
        Row: {
          id: string;
          account_id: string;
          name: string;
          contact_name: string | null;
          contact_email: string | null;
          contact_phone: string | null;
          address_line1: string | null;
          address_line2: string | null;
          city: string | null;
          state: string | null;
          postal_code: string | null;
          country: string | null;
          default_day_rate_cents: number | null;
          default_per_diem_cents: number | null;
          // Added by 20260805090000_phase5_invoices.sql (ALTER TABLE) — the
          // A5 travel-day gap: Phase 3/4 had no field to source a
          // 'travel_day' invoice line's rate from.
          default_travel_day_rate_cents: number | null;
          payment_terms_days: number;
          default_expense_treatment: "rebill" | "deduct" | "unassigned";
          // Added by 20260807000000_phase9_day_types_and_trip_days.sql.
          // 'receipts' is the default because it is what the product
          // already did — meals arrive as pilot.expenses rows.
          per_diem_mode: "per_diem" | "receipts";
          minimum_days: number | null;
          // Added by 20260807040000_client_minimum_basis.sql. What
          // minimum_days is a floor ON — 'per_trip' (the default, and the
          // only behavior that existed before this column) or 'per_month'
          // (settled via pilot.guarantee_periods). See that migration's
          // header for why 'per_trip' had to stay the default.
          minimum_basis: "per_trip" | "per_month";
          cancellation_policy_note: string | null;
          w9_status: "not_requested" | "requested" | "on_file";
          w9_sent_at: string | null;
          w9_received_at: string | null;
          notes: string | null;
          // Added by 20260807130000_operating_rule.sql. 'unspecified' is
          // the default for every pre-existing row — see that migration's
          // header.
          operating_rule: "part_91" | "part_135" | "both" | "unspecified";
          archived_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          account_id: string;
          name: string;
          contact_name?: string | null;
          contact_email?: string | null;
          contact_phone?: string | null;
          address_line1?: string | null;
          address_line2?: string | null;
          city?: string | null;
          state?: string | null;
          postal_code?: string | null;
          country?: string | null;
          default_day_rate_cents?: number | null;
          default_per_diem_cents?: number | null;
          default_travel_day_rate_cents?: number | null;
          payment_terms_days?: number;
          default_expense_treatment?: "rebill" | "deduct" | "unassigned";
          per_diem_mode?: "per_diem" | "receipts";
          minimum_days?: number | null;
          minimum_basis?: "per_trip" | "per_month";
          cancellation_policy_note?: string | null;
          w9_status?: "not_requested" | "requested" | "on_file";
          w9_sent_at?: string | null;
          w9_received_at?: string | null;
          notes?: string | null;
          operating_rule?: "part_91" | "part_135" | "both" | "unspecified";
          archived_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          account_id?: string;
          name?: string;
          contact_name?: string | null;
          contact_email?: string | null;
          contact_phone?: string | null;
          address_line1?: string | null;
          address_line2?: string | null;
          city?: string | null;
          state?: string | null;
          postal_code?: string | null;
          country?: string | null;
          default_day_rate_cents?: number | null;
          default_per_diem_cents?: number | null;
          default_travel_day_rate_cents?: number | null;
          payment_terms_days?: number;
          default_expense_treatment?: "rebill" | "deduct" | "unassigned";
          per_diem_mode?: "per_diem" | "receipts";
          minimum_days?: number | null;
          minimum_basis?: "per_trip" | "per_month";
          cancellation_policy_note?: string | null;
          w9_status?: "not_requested" | "requested" | "on_file";
          w9_sent_at?: string | null;
          w9_received_at?: string | null;
          notes?: string | null;
          operating_rule?: "part_91" | "part_135" | "both" | "unspecified";
          archived_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "clients_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "accounts";
            referencedColumns: ["id"];
          },
        ];
      };
      trips: {
        Row: {
          id: string;
          account_id: string;
          client_id: string | null;
          trip_kind:
            | "owner_trip"
            | "ferry"
            | "maintenance_flight"
            | "repositioning"
            | "contract_pilot"
            | "delivery_flight"
            | "other";
          status: "scheduled" | "in_progress" | "completed" | "canceled";
          starts_on: string;
          ends_on: string;
          aircraft_ident: string | null;
          aircraft_type: string | null;
          day_rate_cents: number;
          day_count: number;
          // Added by 20260805090000_phase5_invoices.sql (ALTER TABLE) — see
          // the same migration's A5 travel-day gap comment on clients.
          travel_day_count: number;
          travel_day_rate_cents: number | null;
          billing_state: "unbilled" | "invoiced" | "paid" | "written_off";
          // Added by 20260807070000_trip_day_units_away_cancel.sql.
          // Trigger-owned (pilot.trips_set_canceled_at) — deliberately
          // absent from Insert/Update below, the same treatment as
          // billing_state/updated_at: app code never sets this directly.
          canceled_at: string | null;
          cancellation_notice_from:
            | "client"
            | "pilot"
            | "weather"
            | "maintenance"
            | "other"
            | null;
          notes: string | null;
          // Added by 20260807130000_operating_rule.sql. Always exactly
          // one part, unlike clients.operating_rule — see that
          // migration's header. Defaults to 'part_91' at the column
          // level; the app seeds it from the selected client at trip
          // creation and leaves it independently editable.
          operating_rule: "part_91" | "part_135";
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          account_id: string;
          client_id?: string | null;
          trip_kind?:
            | "owner_trip"
            | "ferry"
            | "maintenance_flight"
            | "repositioning"
            | "contract_pilot"
            | "delivery_flight"
            | "other";
          status?: "scheduled" | "in_progress" | "completed" | "canceled";
          starts_on: string;
          ends_on: string;
          aircraft_ident?: string | null;
          aircraft_type?: string | null;
          day_rate_cents?: number;
          day_count?: number;
          travel_day_count?: number;
          travel_day_rate_cents?: number | null;
          billing_state?: "unbilled" | "invoiced" | "paid" | "written_off";
          cancellation_notice_from?:
            | "client"
            | "pilot"
            | "weather"
            | "maintenance"
            | "other"
            | null;
          notes?: string | null;
          operating_rule?: "part_91" | "part_135";
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          account_id?: string;
          client_id?: string | null;
          trip_kind?:
            | "owner_trip"
            | "ferry"
            | "maintenance_flight"
            | "repositioning"
            | "contract_pilot"
            | "delivery_flight"
            | "other";
          status?: "scheduled" | "in_progress" | "completed" | "canceled";
          starts_on?: string;
          ends_on?: string;
          aircraft_ident?: string | null;
          aircraft_type?: string | null;
          day_rate_cents?: number;
          day_count?: number;
          travel_day_count?: number;
          travel_day_rate_cents?: number | null;
          billing_state?: "unbilled" | "invoiced" | "paid" | "written_off";
          cancellation_notice_from?:
            | "client"
            | "pilot"
            | "weather"
            | "maintenance"
            | "other"
            | null;
          notes?: string | null;
          operating_rule?: "part_91" | "part_135";
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "trips_account_id_client_id_fkey";
            columns: ["account_id", "client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["account_id", "id"];
          },
        ];
      };
      trip_legs: {
        Row: {
          id: string;
          account_id: string;
          trip_id: string;
          leg_date: string;
          from_icao: string | null;
          to_icao: string | null;
          out_at: string | null;
          in_at: string | null;
          block_hours: number | null;
          night_hours: number | null;
          instrument_hours: number | null;
          day_landings: number;
          night_takeoffs: number;
          night_landings_full_stop: number;
          night_landings_touch_go: number;
          approaches: number;
          holds: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          account_id: string;
          trip_id: string;
          leg_date: string;
          from_icao?: string | null;
          to_icao?: string | null;
          out_at?: string | null;
          in_at?: string | null;
          block_hours?: number | null;
          night_hours?: number | null;
          instrument_hours?: number | null;
          day_landings?: number;
          night_takeoffs?: number;
          night_landings_full_stop?: number;
          night_landings_touch_go?: number;
          approaches?: number;
          holds?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          account_id?: string;
          trip_id?: string;
          leg_date?: string;
          from_icao?: string | null;
          to_icao?: string | null;
          out_at?: string | null;
          in_at?: string | null;
          block_hours?: number | null;
          night_hours?: number | null;
          instrument_hours?: number | null;
          day_landings?: number;
          night_takeoffs?: number;
          night_landings_full_stop?: number;
          night_landings_touch_go?: number;
          approaches?: number;
          holds?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "trip_legs_account_id_trip_id_fkey";
            columns: ["account_id", "trip_id"];
            isOneToOne: false;
            referencedRelation: "trips";
            referencedColumns: ["account_id", "id"];
          },
        ];
      };
      expenses: {
        Row: {
          id: string;
          account_id: string;
          trip_id: string | null;
          incurred_on: string;
          category:
            | "airline"
            | "hotel"
            | "rental_car"
            | "rideshare"
            | "fuel"
            | "meals"
            | "parking"
            | "other";
          vendor: string | null;
          amount_cents: number;
          treatment: "rebill" | "deduct" | "unassigned";
          receipt_path: string | null;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          account_id: string;
          trip_id?: string | null;
          incurred_on: string;
          category:
            | "airline"
            | "hotel"
            | "rental_car"
            | "rideshare"
            | "fuel"
            | "meals"
            | "parking"
            | "other";
          vendor?: string | null;
          amount_cents: number;
          treatment?: "rebill" | "deduct" | "unassigned";
          receipt_path?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          account_id?: string;
          trip_id?: string | null;
          incurred_on?: string;
          category?:
            | "airline"
            | "hotel"
            | "rental_car"
            | "rideshare"
            | "fuel"
            | "meals"
            | "parking"
            | "other";
          vendor?: string | null;
          amount_cents?: number;
          treatment?: "rebill" | "deduct" | "unassigned";
          receipt_path?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "expenses_account_id_trip_id_fkey";
            columns: ["account_id", "trip_id"];
            isOneToOne: false;
            referencedRelation: "trips";
            referencedColumns: ["account_id", "id"];
          },
        ];
      };
      documents: {
        Row: {
          id: string;
          account_id: string;
          kind:
            | "medical"
            | "flight_review"
            | "pic_proficiency_check"
            | "passport"
            | "certificate"
            | "insurance"
            | "w9"
            | "other";
          label: string;
          expires_on: string | null;
          issued_on: string | null;
          client_id: string | null;
          file_path: string | null;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          account_id: string;
          kind:
            | "medical"
            | "flight_review"
            | "pic_proficiency_check"
            | "passport"
            | "certificate"
            | "insurance"
            | "w9"
            | "other";
          label: string;
          expires_on?: string | null;
          issued_on?: string | null;
          client_id?: string | null;
          file_path?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          account_id?: string;
          kind?:
            | "medical"
            | "flight_review"
            | "pic_proficiency_check"
            | "passport"
            | "certificate"
            | "insurance"
            | "w9"
            | "other";
          label?: string;
          expires_on?: string | null;
          issued_on?: string | null;
          client_id?: string | null;
          file_path?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "documents_account_id_client_id_fkey";
            columns: ["account_id", "client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["account_id", "id"];
          },
        ];
      };
      // -----------------------------------------------------------------
      // Phase 9 Layer 1 — 20260807000000_phase9_day_types_and_trip_days.sql
      //
      // day_types is the tenant's own taxonomy; invoice_line_type is the
      // boundary where that taxonomy hands off to Phase 5's fixed line
      // vocabulary. Note it excludes 'per_diem' and 'reimbursable_expense':
      // per-diem lines are computed from counts_for_per_diem, and a
      // reimbursable_expense line must reference a real expense row.
      // -----------------------------------------------------------------
      day_types: {
        Row: {
          id: string;
          account_id: string;
          key: string;
          label: string;
          billable: boolean;
          counts_for_per_diem: boolean;
          default_rate_cents: number | null;
          // Added by 20260807070000_trip_day_units_away_cancel.sql. Rate
          // FRACTION default (0 < x <= 1) — e.g. 0.5 for "travel pays
          // half" — resolved at trip_days capture into trip_days.units,
          // same as default_rate_cents resolves into rate_cents. NULL
          // means no default fraction recorded.
          default_units: number | null;
          invoice_line_type: "flight_day" | "travel_day" | "other";
          sort_order: number;
          is_builtin: boolean;
          archived_at: string | null;
          created_at: string;
          updated_at: string;
        };
        // `is_builtin` is deliberately absent from Insert and Update: it is
        // the seeding trigger's claim about provenance, and the column is
        // withheld from the tenant's grants in the migration. Typing it as
        // writable here would let app code write something the database
        // will reject — a compile-time lie about a runtime rule.
        Insert: {
          account_id: string;
          key: string;
          label: string;
          billable?: boolean;
          counts_for_per_diem?: boolean;
          default_rate_cents?: number | null;
          default_units?: number | null;
          invoice_line_type?: "flight_day" | "travel_day" | "other";
          sort_order?: number;
          archived_at?: string | null;
        };
        // `key` is absent from Update for the same reason: the migration
        // grants UPDATE on label but not key. A pilot renames the label.
        Update: {
          label?: string;
          billable?: boolean;
          counts_for_per_diem?: boolean;
          default_rate_cents?: number | null;
          default_units?: number | null;
          invoice_line_type?: "flight_day" | "travel_day" | "other";
          sort_order?: number;
          archived_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "day_types_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "accounts";
            referencedColumns: ["id"];
          },
        ];
      };
      trip_days: {
        Row: {
          id: string;
          account_id: string;
          trip_id: string;
          day_on: string;
          day_type_id: string;
          // Snapshotted at capture. Never re-resolved from day_types, or a
          // rate change would restate work already flown.
          rate_cents: number;
          // Added by 20260807020000_phase9_review_fixes.sql. Fraction of
          // the day worked, 0.1 to 1.0 — see that migration's section 3
          // for why day_count's numeric(5,1) half-days had nowhere to go
          // without it.
          quantity: number;
          // Added by 20260807070000_trip_day_units_away_cancel.sql. Rate
          // fraction (0 < x <= 1), snapshotted at capture — distinct from
          // quantity (time worked): see that migration's header for why
          // units multiplies into a row's contribution to its invoice
          // group's summed quantity rather than joining the grouping key.
          units: number;
          // Added by the same migration. Away from home base, for per-diem
          // purposes — per diem is counts_for_per_diem (on the day type)
          // AND away (on the day). Defaults false; see that migration's
          // header for why false is the conservative default.
          away: boolean;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          account_id: string;
          trip_id: string;
          day_on: string;
          day_type_id: string;
          rate_cents?: number;
          quantity?: number;
          units?: number;
          away?: boolean;
          notes?: string | null;
        };
        Update: {
          day_on?: string;
          day_type_id?: string;
          rate_cents?: number;
          quantity?: number;
          units?: number;
          away?: boolean;
          notes?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "trip_days_account_id_trip_id_fkey";
            columns: ["account_id", "trip_id"];
            isOneToOne: false;
            referencedRelation: "trips";
            referencedColumns: ["account_id", "id"];
          },
          {
            foreignKeyName: "trip_days_account_id_day_type_id_fkey";
            columns: ["account_id", "day_type_id"];
            isOneToOne: false;
            referencedRelation: "day_types";
            referencedColumns: ["account_id", "id"];
          },
        ];
      };
      client_rates: {
        Row: {
          id: string;
          account_id: string;
          client_id: string;
          day_type_id: string;
          rate_cents: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          account_id: string;
          client_id: string;
          day_type_id: string;
          rate_cents: number;
        };
        // Only the rate moves: (account_id, client_id, day_type_id) is what
        // identifies an override, so re-pointing one is a delete + insert.
        Update: {
          rate_cents?: number;
        };
        Relationships: [
          {
            foreignKeyName: "client_rates_account_id_client_id_fkey";
            columns: ["account_id", "client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["account_id", "id"];
          },
          {
            foreignKeyName: "client_rates_account_id_day_type_id_fkey";
            columns: ["account_id", "day_type_id"];
            isOneToOne: false;
            referencedRelation: "day_types";
            referencedColumns: ["account_id", "id"];
          },
        ];
      };
      stripe_events: {
        // Webhook idempotency/ordering ledger (Phase 2). service_role
        // only — `authenticated` has no grant and no RLS policy, so this
        // type exists for the webhook's own writes, not for app queries.
        Row: {
          id: string;
          type: string;
          stripe_created_at: string;
          object_id: string | null;
          processed_at: string | null;
          livemode: boolean;
          received_at: string;
        };
        Insert: {
          id: string;
          type: string;
          stripe_created_at: string;
          object_id?: string | null;
          processed_at?: string | null;
          livemode: boolean;
          received_at?: string;
        };
        Update: {
          id?: string;
          type?: string;
          stripe_created_at?: string;
          object_id?: string | null;
          processed_at?: string | null;
          livemode?: boolean;
          received_at?: string;
        };
        Relationships: [];
      };
      invoice_number_sequences: {
        Row: { account_id: string; next_number: number };
        Insert: { account_id: string; next_number?: number };
        // next_number is advanced ONLY via pilot.next_invoice_number() —
        // the grant permits a direct UPDATE at the database level, but no
        // application code should ever write this column directly; go
        // through the function so numbering stays atomic and gapless
        // within a session.
        Update: { account_id?: string; next_number?: number };
        Relationships: [];
      };
      invoices: {
        // paid_at/amount_paid_cents were removed by
        // 20260805090000_phase5_invoices.sql — moved to the
        // invoice_payments ledger table (dated per-payment, for C3
        // cash-basis correctness) and now DERIVED via invoice_totals.
        Row: {
          id: string;
          account_id: string;
          client_id: string;
          invoice_number: string | null;
          status: "draft" | "sent" | "partial" | "paid" | "void";
          issued_on: string | null;
          due_on: string | null;
          sent_at: string | null;
          tax_rate_bps: number;
          delivery_method: "platform_email" | "manual_download" | null;
          notes: string | null;
          // 20260809040000_connect_payments.sql (+ the amount column, from
          // 20260810010000). Ordinary tenant business data, not a
          // billing/entitlement column — see that migration's header for
          // why these are authenticated-writable while
          // accounts.connect_account_id is not. They move as a set: every
          // writer sets all four or clears all four.
          stripe_payment_link_id: string | null;
          stripe_payment_link_url: string | null;
          stripe_payment_link_livemode: boolean | null;
          stripe_payment_link_amount_cents: number | null;
          created_at: string;
          updated_at: string;
        };
        // status/invoice_number/sent_at are forced by
        // invoices_force_draft_on_insert regardless of what's sent, and
        // withheld from the INSERT grant — included here only because the
        // Row shape requires them; do not populate them from application
        // code on insert.
        Insert: {
          id?: string;
          account_id: string;
          client_id: string;
          invoice_number?: string | null;
          status?: "draft" | "sent" | "partial" | "paid" | "void";
          issued_on?: string | null;
          due_on?: string | null;
          sent_at?: string | null;
          tax_rate_bps?: number;
          delivery_method?: "platform_email" | "manual_download" | null;
          notes?: string | null;
          stripe_payment_link_id?: string | null;
          stripe_payment_link_url?: string | null;
          stripe_payment_link_livemode?: boolean | null;
          stripe_payment_link_amount_cents?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        // Billing facts (client_id, issued_on, due_on, tax_rate_bps,
        // invoice_number) are only writable at the database while
        // status='draft' — see invoices_protect_issued in the migration.
        // Once issued, only status/sent_at/delivery_method/notes may
        // change (and status only forward, and only to 'partial'/'paid'
        // once an invoice_payments row exists). This type does not encode
        // that state-dependent narrowing; see the accounts.Update comment
        // above for why.
        Update: {
          id?: string;
          account_id?: string;
          client_id?: string;
          invoice_number?: string | null;
          status?: "draft" | "sent" | "partial" | "paid" | "void";
          issued_on?: string | null;
          due_on?: string | null;
          sent_at?: string | null;
          tax_rate_bps?: number;
          delivery_method?: "platform_email" | "manual_download" | null;
          notes?: string | null;
          stripe_payment_link_id?: string | null;
          stripe_payment_link_url?: string | null;
          stripe_payment_link_livemode?: boolean | null;
          stripe_payment_link_amount_cents?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "invoices_account_id_client_id_fkey";
            columns: ["account_id", "client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["account_id", "id"];
          },
        ];
      };
      invoice_lines: {
        Row: {
          id: string;
          account_id: string;
          invoice_id: string;
          line_type:
            | "flight_day"
            | "travel_day"
            | "per_diem"
            | "reimbursable_expense"
            | "cancellation_fee"
            | "other";
          description: string;
          quantity: number;
          unit_amount_cents: number;
          // GENERATED ALWAYS AS (round(quantity * unit_amount_cents)::bigint)
          // STORED — never present it as writable in application code, even
          // though PostgREST/Supabase will reject a write to it regardless.
          amount_cents: number;
          // C10: defaults true; app sets false for per_diem/
          // reimbursable_expense per the pilot's own state tax rules.
          taxable: boolean;
          trip_id: string | null;
          expense_id: string | null;
          // A3 enforcement: must equal 'rebill' whenever expense_id is
          // set, null otherwise — enforced by CHECK + the composite FK to
          // expenses(account_id, id, treatment) below, not just convention.
          expense_treatment: "rebill" | null;
          sort_order: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          account_id: string;
          invoice_id: string;
          line_type:
            | "flight_day"
            | "travel_day"
            | "per_diem"
            | "reimbursable_expense"
            | "cancellation_fee"
            | "other";
          description: string;
          quantity?: number;
          unit_amount_cents: number;
          taxable?: boolean;
          trip_id?: string | null;
          expense_id?: string | null;
          expense_treatment?: "rebill" | null;
          sort_order?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          account_id?: string;
          invoice_id?: string;
          line_type?:
            | "flight_day"
            | "travel_day"
            | "per_diem"
            | "reimbursable_expense"
            | "cancellation_fee"
            | "other";
          description?: string;
          quantity?: number;
          unit_amount_cents?: number;
          taxable?: boolean;
          trip_id?: string | null;
          expense_id?: string | null;
          expense_treatment?: "rebill" | null;
          sort_order?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "invoice_lines_account_id_invoice_id_fkey";
            columns: ["account_id", "invoice_id"];
            isOneToOne: false;
            referencedRelation: "invoices";
            referencedColumns: ["account_id", "id"];
          },
          {
            foreignKeyName: "invoice_lines_account_id_trip_id_fkey";
            columns: ["account_id", "trip_id"];
            isOneToOne: false;
            referencedRelation: "trips";
            referencedColumns: ["account_id", "id"];
          },
          {
            foreignKeyName: "invoice_lines_account_id_expense_id_expense_treatment_fkey";
            columns: ["account_id", "expense_id", "expense_treatment"];
            isOneToOne: false;
            referencedRelation: "expenses";
            referencedColumns: ["account_id", "id", "treatment"];
          },
        ];
      };
      invoice_payments: {
        // No Update type: no update grant to authenticated — a recorded
        // payment is a ledger entry, corrected only by service_role. Also
        // no delete grant.
        Row: {
          id: string;
          account_id: string;
          invoice_id: string;
          paid_on: string;
          amount_cents: number;
          method: "ach" | "check" | "wire" | "card" | "cash" | "other" | null;
          notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          account_id: string;
          invoice_id: string;
          paid_on: string;
          amount_cents: number;
          method?: "ach" | "check" | "wire" | "card" | "cash" | "other" | null;
          notes?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "invoice_payments_account_id_invoice_id_fkey";
            columns: ["account_id", "invoice_id"];
            isOneToOne: false;
            referencedRelation: "invoices";
            referencedColumns: ["account_id", "id"];
          },
        ];
      };
      // Added by 20260809060000_invoice_public_share.sql. No Insert/Update
      // types: there is no direct INSERT/UPDATE grant to authenticated —
      // every write goes through pilot.invoice_share_create/
      // pilot.invoice_share_revoke (see Functions below), never a plain
      // `.insert()`/`.update()` call. `token` is readable by the owning
      // account's own members (to re-copy a link) but is never readable by
      // anon directly — anon only ever reaches invoice data through the
      // pilot.invoice_public RPC, which takes the token as an argument
      // rather than exposing this table.
      invoice_shares: {
        Row: {
          id: string;
          account_id: string;
          invoice_id: string;
          token: string;
          created_at: string;
          created_by: string | null;
          revoked_at: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "invoice_shares_account_id_invoice_id_fkey";
            columns: ["account_id", "invoice_id"];
            isOneToOne: true;
            referencedRelation: "invoices";
            referencedColumns: ["account_id", "id"];
          },
        ];
      };
      // Added by 20260807040000_client_minimum_basis.sql. One row per
      // (client, calendar month) a 'per_month' minimum_basis client has
      // been drafted against — settled_invoice_id is what stops
      // createInvoiceDraft from topping up the same month twice across two
      // different invoices. See the migration for the full mechanism.
      guarantee_periods: {
        Row: {
          id: string;
          account_id: string;
          client_id: string;
          period_month: string;
          guaranteed_days: number;
          settled_invoice_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          account_id: string;
          client_id: string;
          period_month: string;
          guaranteed_days: number;
          settled_invoice_id?: string | null;
        };
        // client_id/period_month are NOT updatable — together with
        // account_id they identify the row (unique (account_id, client_id,
        // period_month)); re-pointing either is a delete and an insert, the
        // same discipline pilot.client_rates uses for its own identifying
        // columns.
        Update: {
          guaranteed_days?: number;
          settled_invoice_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "guarantee_periods_account_id_client_id_fkey";
            columns: ["account_id", "client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["account_id", "id"];
          },
          {
            foreignKeyName: "guarantee_periods_account_id_settled_invoice_id_fkey";
            columns: ["account_id", "settled_invoice_id"];
            isOneToOne: false;
            referencedRelation: "invoices";
            referencedColumns: ["account_id", "id"];
          },
        ];
      };
      // -----------------------------------------------------------------
      // 20260807060000_operator_qualifications.sql — what the pilot has
      // been told/shown by an operator about their standing on THAT
      // operator's Part 135 certificate. NOT a determination that they
      // are on the certificate. expires_on is derived (by
      // pilot.compute_operator_qualification_expiry, a BEFORE INSERT OR
      // UPDATE trigger) for competency_check_135_293, ipc_135_297 and
      // line_check_135_299 only, including the 135.301(a) one-month-
      // early/one-month-late provision; every other requirement kind
      // leaves it as whatever was submitted (nullable, pilot-entered).
      // -----------------------------------------------------------------
      operator_qualifications: {
        Row: {
          id: string;
          account_id: string;
          client_id: string;
          requirement:
            | "basic_indoc"
            | "initial_training"
            | "recurrent_training"
            | "competency_check_135_293"
            | "ipc_135_297"
            | "line_check_135_299"
            | "drug_alcohol_program_120"
            | "prd_consent_111"
            | "insurance_approval"
            | "company_manuals"
            | "other";
          completed_on: string | null;
          status: "not_started" | "in_progress" | "current" | "lapsed" | "n_a";
          expires_on: string | null;
          type_designator: string;
          notes: string | null;
          document_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          account_id: string;
          client_id: string;
          requirement:
            | "basic_indoc"
            | "initial_training"
            | "recurrent_training"
            | "competency_check_135_293"
            | "ipc_135_297"
            | "line_check_135_299"
            | "drug_alcohol_program_120"
            | "prd_consent_111"
            | "insurance_approval"
            | "company_manuals"
            | "other";
          completed_on?: string | null;
          status?: "not_started" | "in_progress" | "current" | "lapsed" | "n_a";
          expires_on?: string | null;
          type_designator?: string;
          notes?: string | null;
          document_id?: string | null;
        };
        // client_id/requirement/type_designator are NOT updatable — the
        // three together identify the row (unique(account_id, client_id,
        // requirement, type_designator)); re-pointing any of them is a
        // delete-and-insert, matching client_rates/guarantee_periods.
        Update: {
          completed_on?: string | null;
          status?: "not_started" | "in_progress" | "current" | "lapsed" | "n_a";
          expires_on?: string | null;
          notes?: string | null;
          document_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "operator_qualifications_account_id_client_id_fkey";
            columns: ["account_id", "client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["account_id", "id"];
          },
          {
            foreignKeyName: "operator_qualifications_account_id_document_id_fkey";
            columns: ["account_id", "document_id"];
            isOneToOne: false;
            referencedRelation: "documents";
            referencedColumns: ["account_id", "id"];
          },
        ];
      };
      // Added by 20260809070000_bank_transactions.sql. See that migration's
      // header for the amount_cents sign convention (negative = money out
      // = expense candidate, for every account kind — credit_card CSV rows
      // are flipped to canonical sign at parse time; see lib/bank-import/
      // apply-mapping.ts).
      bank_accounts: {
        Row: {
          id: string;
          account_id: string;
          label: string;
          last4: string | null;
          kind: "checking" | "savings" | "credit_card";
          archived_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          account_id: string;
          label: string;
          last4?: string | null;
          kind: "checking" | "savings" | "credit_card";
          archived_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          label?: string;
          last4?: string | null;
          kind?: "checking" | "savings" | "credit_card";
          archived_at?: string | null;
        };
        Relationships: [];
      };
      bank_import_batches: {
        Row: {
          id: string;
          account_id: string;
          bank_account_id: string;
          source_format: "csv_signed" | "csv_debit_credit" | "ofx" | "qfx";
          status: "pending" | "processing" | "completed" | "partial" | "failed";
          total_rows: number;
          imported_rows: number;
          rejected_rows: number;
          duplicate_rows: number;
          error_summary: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          account_id: string;
          bank_account_id: string;
          source_format: "csv_signed" | "csv_debit_credit" | "ofx" | "qfx";
          status?: "pending" | "processing" | "completed" | "partial" | "failed";
          total_rows?: number;
          imported_rows?: number;
          rejected_rows?: number;
          duplicate_rows?: number;
          error_summary?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          status?: "pending" | "processing" | "completed" | "partial" | "failed";
          total_rows?: number;
          imported_rows?: number;
          rejected_rows?: number;
          duplicate_rows?: number;
          error_summary?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "bank_import_batches_account_id_bank_account_id_fkey";
            columns: ["account_id", "bank_account_id"];
            isOneToOne: false;
            referencedRelation: "bank_accounts";
            referencedColumns: ["account_id", "id"];
          },
        ];
      };
      bank_source_files: {
        Row: {
          id: string;
          account_id: string;
          import_batch_id: string;
          file_name: string;
          row_count: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          account_id: string;
          import_batch_id: string;
          file_name: string;
          row_count?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          file_name?: string;
          row_count?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "bank_source_files_account_id_import_batch_id_fkey";
            columns: ["account_id", "import_batch_id"];
            isOneToOne: false;
            referencedRelation: "bank_import_batches";
            referencedColumns: ["account_id", "id"];
          },
        ];
      };
      bank_transactions: {
        Row: {
          id: string;
          account_id: string;
          bank_account_id: string;
          import_batch_id: string;
          source_file_id: string;
          source_row_number: number;
          source_row: Json;
          posted_on: string;
          description: string;
          amount_cents: number;
          fingerprint: string;
          review_state: "unreviewed" | "reviewed" | "ignored";
          suggested_category:
            | "airline" | "hotel" | "rental_car" | "rideshare" | "fuel" | "meals" | "parking" | "other" | null;
          category:
            | "airline" | "hotel" | "rental_car" | "rideshare" | "fuel" | "meals" | "parking" | "other" | null;
          treatment: "rebill" | "deduct" | "unassigned" | null;
          trip_id: string | null;
          expense_id: string | null;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          account_id: string;
          bank_account_id: string;
          import_batch_id: string;
          source_file_id: string;
          source_row_number: number;
          source_row: Json;
          posted_on: string;
          description: string;
          amount_cents: number;
          fingerprint: string;
          review_state?: "unreviewed" | "reviewed" | "ignored";
          suggested_category?:
            | "airline" | "hotel" | "rental_car" | "rideshare" | "fuel" | "meals" | "parking" | "other" | null;
          category?:
            | "airline" | "hotel" | "rental_car" | "rideshare" | "fuel" | "meals" | "parking" | "other" | null;
          treatment?: "rebill" | "deduct" | "unassigned" | null;
          trip_id?: string | null;
          expense_id?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        // Note the missing columns relative to Insert: source_row_number,
        // fingerprint, posted_on, description, amount_cents,
        // bank_account_id, import_batch_id, source_file_id are NOT here —
        // there is no update grant on them at all (see the migration's
        // grants section), so they are not representable as an update
        // payload by construction, not merely by convention.
        Update: {
          review_state?: "unreviewed" | "reviewed" | "ignored";
          suggested_category?:
            | "airline" | "hotel" | "rental_car" | "rideshare" | "fuel" | "meals" | "parking" | "other" | null;
          category?:
            | "airline" | "hotel" | "rental_car" | "rideshare" | "fuel" | "meals" | "parking" | "other" | null;
          treatment?: "rebill" | "deduct" | "unassigned" | null;
          trip_id?: string | null;
          expense_id?: string | null;
          notes?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "bank_transactions_account_id_bank_account_id_fkey";
            columns: ["account_id", "bank_account_id"];
            isOneToOne: false;
            referencedRelation: "bank_accounts";
            referencedColumns: ["account_id", "id"];
          },
          {
            foreignKeyName: "bank_transactions_account_id_expense_id_fkey";
            columns: ["account_id", "expense_id"];
            isOneToOne: false;
            referencedRelation: "expenses";
            referencedColumns: ["account_id", "id"];
          },
          {
            foreignKeyName: "bank_transactions_account_id_trip_id_fkey";
            columns: ["account_id", "trip_id"];
            isOneToOne: false;
            referencedRelation: "trips";
            referencedColumns: ["account_id", "id"];
          },
        ];
      };
      // -----------------------------------------------------------------
      // 20260809020000_mileage.sql — mileage / vehicle deduction tracking.
      // rate_cents_per_mile is numeric(6,3) (not bigint cents) because the
      // published rate carries a fractional cent; mileage_entries snapshots
      // it at capture and never re-resolves it from mileage_rates. See the
      // migration header for the full money-type reasoning.
      //
      // mileage_entries.rate_cents_per_mile is listed below in Update for
      // shape-completeness only (it mirrors the Row/Insert types) — as of
      // 20260809050000_mileage_and_recurring_fixes.sql, `authenticated`
      // has NO UPDATE grant on this column at the database, and the app
      // layer (expenses/mileage/actions.ts) never attempts to write it on
      // update. Do not add it back to an UPDATE payload.
      // -----------------------------------------------------------------
      mileage_rates: {
        Row: {
          id: string;
          account_id: string;
          tax_year: number;
          rate_cents_per_mile: number;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          account_id: string;
          tax_year: number;
          rate_cents_per_mile: number;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          account_id?: string;
          tax_year?: number;
          rate_cents_per_mile?: number;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      mileage_entries: {
        Row: {
          id: string;
          account_id: string;
          drove_on: string;
          miles: number;
          from_place: string;
          to_place: string;
          purpose: string;
          trip_id: string | null;
          client_id: string | null;
          rate_cents_per_mile: number;
          // GENERATED column — never present in Insert/Update below.
          amount_cents: number;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          account_id: string;
          drove_on: string;
          miles: number;
          from_place: string;
          to_place: string;
          purpose: string;
          trip_id?: string | null;
          client_id?: string | null;
          rate_cents_per_mile: number;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          account_id?: string;
          drove_on?: string;
          miles?: number;
          from_place?: string;
          to_place?: string;
          purpose?: string;
          trip_id?: string | null;
          client_id?: string | null;
          rate_cents_per_mile?: number;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "mileage_entries_account_id_trip_id_fkey";
            columns: ["account_id", "trip_id"];
            isOneToOne: false;
            referencedRelation: "trips";
            referencedColumns: ["account_id", "id"];
          },
          {
            foreignKeyName: "mileage_entries_account_id_client_id_fkey";
            columns: ["account_id", "client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["account_id", "id"];
          },
        ];
      };
      // -----------------------------------------------------------------
      // 20260809030000_recurring_invoices.sql. A standing cadence a pilot
      // bills a client on (fixed description + amount, monthly or
      // quarterly). See the migration header for why this is fixed-amount
      // only (no monthly-guarantee/guarantee_periods linkage yet) and why
      // client_id/cadence/anchor_date are not updatable.
      // -----------------------------------------------------------------
      recurring_invoice_schedules: {
        Row: {
          id: string;
          account_id: string;
          client_id: string;
          cadence: "monthly" | "quarterly";
          anchor_date: string;
          end_date: string | null;
          description: string;
          amount_cents: number;
          tax_rate_bps: number;
          active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          account_id: string;
          client_id: string;
          cadence: "monthly" | "quarterly";
          anchor_date: string;
          end_date?: string | null;
          description: string;
          amount_cents: number;
          tax_rate_bps?: number;
          active?: boolean;
        };
        Update: {
          end_date?: string | null;
          description?: string;
          amount_cents?: number;
          tax_rate_bps?: number;
          active?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "recurring_invoice_schedules_account_id_client_id_fkey";
            columns: ["account_id", "client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["account_id", "id"];
          },
        ];
      };
      // -----------------------------------------------------------------
      // 20260809030000_recurring_invoices.sql. The idempotency ledger: one
      // row per (schedule, period_start) ever generated. unique
      // (account_id, schedule_id, period_start) is what makes a double
      // generation impossible — see the migration header. No UPDATE/DELETE
      // grant exists on this table at all (a generation, once recorded, is
      // an immutable fact), so this type carries no Update shape.
      // -----------------------------------------------------------------
      recurring_invoice_generations: {
        Row: {
          id: string;
          account_id: string;
          schedule_id: string;
          period_start: string;
          invoice_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          account_id: string;
          schedule_id: string;
          period_start: string;
          invoice_id: string;
        };
        Relationships: [
          {
            foreignKeyName: "recurring_invoice_generations_account_id_schedule_id_fkey";
            columns: ["account_id", "schedule_id"];
            isOneToOne: false;
            referencedRelation: "recurring_invoice_schedules";
            referencedColumns: ["account_id", "id"];
          },
          {
            foreignKeyName: "recurring_invoice_generations_account_id_invoice_id_fkey";
            columns: ["account_id", "invoice_id"];
            isOneToOne: false;
            referencedRelation: "invoices";
            referencedColumns: ["account_id", "id"];
          },
        ];
      };
    };
    Views: {
      expirations: {
        Row: {
          source_table: string;
          source_id: string;
          account_id: string;
          item_kind: string;
          item_label: string;
          expires_on: string;
          days_remaining: number;
          ladder_stage: "overdue" | "t_minus_1" | "t_minus_7" | "t_minus_14" | "t_minus_30" | "ok";
        };
        Relationships: [];
      };
      invoice_totals: {
        Row: {
          invoice_id: string;
          account_id: string;
          subtotal_cents: number;
          tax_cents: number;
          total_cents: number;
          amount_paid_cents: number;
          last_paid_on: string | null;
          balance_due_cents: number;
        };
        Relationships: [
          {
            foreignKeyName: "invoice_totals_invoice_id_fkey";
            columns: ["invoice_id"];
            isOneToOne: true;
            referencedRelation: "invoices";
            referencedColumns: ["id"];
          },
        ];
      };
      invoices_overdue: {
        Row: {
          invoice_id: string;
          account_id: string;
          due_on: string;
          days_overdue: number;
        };
        Relationships: [
          {
            foreignKeyName: "invoices_overdue_invoice_id_fkey";
            columns: ["invoice_id"];
            isOneToOne: true;
            referencedRelation: "invoices";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Functions: {
      current_account_ids: {
        Args: Record<string, never>;
        Returns: string[];
      };
      is_account_owner: {
        Args: { target_account_id: string };
        Returns: boolean;
      };
      expiration_coverage_gaps: {
        Args: Record<string, never>;
        Returns: { missing_table: string }[];
      };
      next_invoice_number: {
        Args: { target_account_id: string };
        Returns: string;
      };
      // Added by 20260807020000_phase9_review_fixes.sql. The label of a
      // live (non-void) invoice billing this trip ("INV-0042" or "a draft
      // invoice"), or null. SECURITY INVOKER — see that migration's
      // section 2 for why this is the single definition every freeze
      // guard, and this app, reads instead of trips.billing_state.
      trip_committed_invoice: {
        Args: { p_account_id: string; p_trip_id: string };
        Returns: string | null;
      };
      // Added by 20260809050000_mileage_and_recurring_fixes.sql (defect 6
      // fix). SECURITY DEFINER: writes the invoice, its line, and the
      // recurring_invoice_generations ledger row as one atomic statement
      // so a partial failure (including the ledger's own 23505) can never
      // leave an orphaned invoice/line behind. Returns the new invoice id,
      // or raises (never trust a caller-supplied account_id — the
      // function re-derives it from the schedule after checking
      // pilot.current_account_ids()). Does not check period due-ness —
      // the caller (generateRecurringInvoice, recurring/actions.ts) still
      // does that server-side before calling.
      generate_recurring_invoice: {
        Args: { p_schedule_id: string; p_period_start: string };
        Returns: string;
      };

      // Added by 20260809040000_connect_payments.sql. All three are
      // SECURITY DEFINER, owner-gated, and derive the caller from
      // auth.uid() internally rather than trusting anything about "who's
      // calling" — see that migration's header for why these exist
      // instead of widening lib/supabase/service-role.ts.
      //
      // 20260810010000 then CHANGED connect_account_link's signature: it
      // now takes the single-use OAuth state minted by
      // connect_oauth_state_begin and reads the account off the consumed
      // state row, returning that account id. The old
      // (p_account_id, p_connect_account_id) shape was callable straight
      // over PostgREST by any signed-in owner, with no OAuth round trip
      // and no livemode check — it is dropped, not overloaded.
      connect_oauth_state_begin: {
        Args: { p_account_id: string };
        Returns: string;
      };
      connect_account_link: {
        Args: { p_connect_account_id: string; p_state: string };
        Returns: string;
      };
      connect_account_unlink: {
        Args: { p_account_id: string };
        Returns: undefined;
      };
      // Added by 20260809060000_invoice_public_share.sql. SECURITY
      // DEFINER, membership-gated via current_account_ids() (not
      // owner-only). Returns the newly minted (or rotated) token as plain
      // text — see share-actions.ts for why nothing downstream logs it.
      invoice_share_create: {
        Args: { p_invoice_id: string };
        Returns: string;
      };
      invoice_share_revoke: {
        Args: { p_invoice_id: string };
        Returns: undefined;
      };
      // The ONE path from an unauthenticated request to invoice data —
      // granted to anon AND authenticated (a signed-in pilot previewing
      // their own share link goes through the identical call). Returns
      // null for an unknown/revoked/no-longer-shareable token, never an
      // error — see the migration and app/invoice/[token]/page.tsx for the
      // full field-by-field justification of the jsonb shape.
      invoice_public: {
        Args: { p_token: string };
        Returns: Json;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
