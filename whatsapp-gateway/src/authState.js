import { initAuthCreds, BufferJSON, proto } from "@whiskeysockets/baileys";
import { supabase } from "./supabase.js";

// wp_data.auth_state guarda JSONB. BufferJSON serializa los Buffers a
// { type: "Buffer", data: [...] }; el round-trip via JSON conserva ese formato.
const encode = (value) => JSON.parse(JSON.stringify(value, BufferJSON.replacer));
const decode = (value) =>
  value == null ? null : JSON.parse(JSON.stringify(value), BufferJSON.reviver);

async function readMany(ids) {
  if (ids.length === 0) return {};
  const { data, error } = await supabase.rpc("wp_gw_auth_read", { p_ids: ids });
  if (error) throw error;
  const out = {};
  for (const row of data ?? []) out[row.id] = decode(row.data);
  return out;
}

async function writeOne(id, value) {
  const { error } = await supabase.rpc("wp_gw_auth_write", {
    p_id: id,
    p_data: encode(value),
  });
  if (error) throw error;
}

async function removeMany(ids) {
  if (ids.length === 0) return;
  const { error } = await supabase.rpc("wp_gw_auth_remove", { p_ids: ids });
  if (error) throw error;
}

/**
 * Estado de autenticacion de Baileys respaldado en wp_data.auth_state.
 * Equivalente a useMultiFileAuthState pero usando la base de datos, para que
 * la sesion sobreviva reinicios del gateway sin volver a escanear el QR.
 */
export async function useSupabaseAuthState() {
  const initial = await readMany(["creds"]);
  const creds = initial.creds || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const keyed = ids.map((id) => `${type}-${id}`);
          const rows = await readMany(keyed);
          const result = {};
          for (const id of ids) {
            let value = rows[`${type}-${id}`] ?? null;
            if (value && type === "app-state-sync-key") {
              value = proto.Message.AppStateSyncKeyData.fromObject(value);
            }
            result[id] = value;
          }
          return result;
        },
        set: async (data) => {
          const writes = [];
          const deletes = [];
          for (const type of Object.keys(data)) {
            for (const id of Object.keys(data[type])) {
              const value = data[type][id];
              const key = `${type}-${id}`;
              if (value) writes.push(writeOne(key, value));
              else deletes.push(key);
            }
          }
          await Promise.all([
            ...writes,
            deletes.length ? removeMany(deletes) : Promise.resolve(),
          ]);
        },
      },
    },
    saveCreds: async () => {
      await writeOne("creds", creds);
    },
    clearAll: async () => {
      const { error } = await supabase.rpc("wp_gw_auth_reset");
      if (error) throw error;
    },
  };
}
