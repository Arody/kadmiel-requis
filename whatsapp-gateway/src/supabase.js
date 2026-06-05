import { createClient } from "@supabase/supabase-js";
import { config } from "./config.js";

// Cliente con service_role: bypassa RLS y puede ejecutar las RPCs wp_gw_*.
// Todo el acceso a wp_data pasa por esas RPCs en el schema public, asi que
// NO hace falta exponer wp_data a PostgREST.
export const supabase = createClient(
  config.supabaseUrl,
  config.supabaseServiceRoleKey,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  },
);
