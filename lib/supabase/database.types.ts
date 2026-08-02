/**
 * Hand-authored from the LIVE schema of the "V1 Pilot" Supabase project
 * (igbeahtixmbanjdyqgwo), verified via list_tables against the applied
 * migration — not a placeholder, but also not machine-generated yet.
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
 * Until then, keep this in lockstep with
 * supabase/migrations/20260802120000_pilot_schema_tenancy.sql by hand —
 * it was written directly from that migration's applied result, not from
 * the migration file's text, so it reflects what's actually live.
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
        // the database grant to legal_name/address_*/city/state/
        // postal_code/country/logo_url/invoice_prefix — see the migration.
        // This Update type is intentionally NOT narrowed to match: it
        // describes the shape of the row, not who may write which column.
        // Attempting to update a billing column via the authenticated
        // client fails at the database (grant denial or the
        // protect_account_billing_columns trigger), not at the type
        // layer — narrowing this type would just hide that enforcement
        // exists rather than duplicate it.
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
    };
    Views: Record<string, never>;
    Functions: {
      current_account_ids: {
        Args: Record<string, never>;
        Returns: string[];
      };
      is_account_owner: {
        Args: { target_account_id: string };
        Returns: boolean;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
