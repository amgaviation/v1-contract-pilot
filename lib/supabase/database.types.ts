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
          cancellation_policy_note: string | null;
          w9_status: "not_requested" | "requested" | "on_file";
          w9_sent_at: string | null;
          w9_received_at: string | null;
          notes: string | null;
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
          cancellation_policy_note?: string | null;
          w9_status?: "not_requested" | "requested" | "on_file";
          w9_sent_at?: string | null;
          w9_received_at?: string | null;
          notes?: string | null;
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
          cancellation_policy_note?: string | null;
          w9_status?: "not_requested" | "requested" | "on_file";
          w9_sent_at?: string | null;
          w9_received_at?: string | null;
          notes?: string | null;
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
          notes: string | null;
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
          notes?: string | null;
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
          notes?: string | null;
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
          notes?: string | null;
        };
        Update: {
          day_on?: string;
          day_type_id?: string;
          rate_cents?: number;
          quantity?: number;
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
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
