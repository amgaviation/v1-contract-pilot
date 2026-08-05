import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { ClientOption } from "./document-form";

type ClientRow = { id: string; name: string };

/**
 * Clients a document can be linked to (e.g. an insurance certificate or a
 * W-9 that names one specific client). Archived clients are still offered
 * — a W-9 already on file for a client the pilot stopped flying for is
 * still a real record, not one to hide.
 */
export async function loadClientOptions(): Promise<{
  clients: ClientOption[];
  error: string | null;
}> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clients")
    .select("id, name")
    .order("name", { ascending: true });

  if (error) return { clients: [], error: error.message };

  const clients = ((data ?? []) as ClientRow[]).map((client) => ({
    id: client.id,
    label: client.name,
  }));
  return { clients, error: null };
}
