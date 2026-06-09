import { BufferJSON, initAuthCreds, type AuthenticationCreds, type AuthenticationState, type SignalDataTypeMap } from '@whiskeysockets/baileys';
import { createClient } from '@supabase/supabase-js';
import { env } from './config.js';

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_KEY);

export async function useSupabaseAuthState(sessionName: string = 'default'): Promise<{ state: AuthenticationState, saveCreds: () => Promise<void> }> {
  // We use basic memory caching to reduce read hits to Supabase
  const cache = new Map<string, any>();

  const readData = async (id: string) => {
    try {
      if (cache.has(id)) return cache.get(id);
      const { data, error } = await supabase.from('baileys_auth').select('data').eq('id', `${sessionName}-${id}`).single();
      if (error || !data?.data) return null;
      const parsed = JSON.parse(data.data, BufferJSON.reviver);
      cache.set(id, parsed);
      return parsed;
    } catch {
      return null;
    }
  };

  const writeData = async (data: any, id: string) => {
    try {
      const stringified = JSON.stringify(data, BufferJSON.replacer);
      cache.set(id, data);
      await supabase.from('baileys_auth').upsert({
        id: `${sessionName}-${id}`,
        data: stringified,
        updated_at: new Date().toISOString()
      }, { onConflict: 'id' });
    } catch (err) {
      console.error('[auth] failed to write auth data', id);
    }
  };

  const removeData = async (id: string) => {
    try {
      cache.delete(id);
      await supabase.from('baileys_auth').delete().eq('id', `${sessionName}-${id}`);
    } catch (err) {
      console.error('[auth] failed to remove auth data', id);
    }
  };

  const creds: AuthenticationCreds = await readData('creds') || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data: { [id: string]: SignalDataTypeMap[typeof type] } = {};
          await Promise.all(
            ids.map(async (id) => {
              let val = await readData(`${type}-${id}`);
              if (type === 'app-state-sync-key' && val) {
                val = { ...val, value: Buffer.from(val.value, 'base64') };
              }
              data[id] = val;
            })
          );
          return data;
        },
        set: async (data) => {
          const tasks: Promise<void>[] = [];
          for (const category in data) {
            for (const id in data[category as keyof typeof data]) {
              const value = data[category as keyof typeof data]?.[id];
              const key = `${category}-${id}`;
              if (value) {
                let saveValue = value;
                if (category === 'app-state-sync-key') {
                   saveValue = { ...(value as Record<string, any>), value: (value as any).value.toString('base64') };
                }
                tasks.push(writeData(saveValue, key));
              } else {
                tasks.push(removeData(key));
              }
            }
          }
          await Promise.all(tasks);
        }
      }
    },
    saveCreds: () => writeData(creds, 'creds')
  };
}
