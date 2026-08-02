/**
 * PLACEHOLDER. Real types are generated from the live schema once the
 * new Supabase project exists and supabase/migrations/*.sql has been
 * applied:
 *
 *   supabase gen types typescript --project-id <new-project-ref> \
 *     --schema pilot > lib/supabase/database.types.ts
 *
 * Do not hand-edit table shapes here once generation is possible —
 * regenerate instead, so this file can never drift from the schema.
 */
export type Database = {
  pilot: {
    Tables: Record<string, never>;
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
};
