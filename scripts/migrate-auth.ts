import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

const BufferJSON = {
    replacer: (k: any, value: any) => {
        if (Buffer.isBuffer(value) || value instanceof Uint8Array || value?.type === 'Buffer') {
            return { type: 'Buffer', data: Buffer.from(value?.data || value).toString('base64') };
        }
        return value;
    },
    reviver: (_: any, value: any) => {
        if (typeof value === 'object' && !!value && (value.buffer === true || value.type === 'Buffer')) {
            const val = value.data || value.value;
            return typeof val === 'string' ? Buffer.from(val, 'base64') : Buffer.from(val || []);
        }
        return value;
    }
};

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const AUTH_DIR = path.resolve('auth_info_baileys');

async function migrate() {
  if (!fs.existsSync(AUTH_DIR)) {
    console.log('No auth_info_baileys directory found. Nothing to migrate.');
    return;
  }

  const files = fs.readdirSync(AUTH_DIR).filter(f => f.endsWith('.json'));
  if (files.length === 0) {
    console.log('No JSON files found in auth_info_baileys.');
    return;
  }

  console.log(`Found ${files.length} auth files to migrate...`);

  let success = 0;
  let failed = 0;

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(AUTH_DIR, file), 'utf-8');
      
      // We parse and re-stringify to ensure it is valid JSON
      const parsed = JSON.parse(content, BufferJSON.reviver);
      const stringified = JSON.stringify(parsed, BufferJSON.replacer);

      // Baileys keys are mapped as {type}-{id}. 
      // The local file system usually stores them as `pre-key-1.json` or `creds.json`.
      // We map the filename (without .json) to the database ID: `default-filename`
      const dbId = `default-${file.replace('.json', '')}`;

      const { error } = await supabase.from('baileys_auth').upsert({
        id: dbId,
        data: stringified,
        updated_at: new Date().toISOString()
      }, { onConflict: 'id' });

      if (error) {
        console.error(`❌ Failed to insert ${file}:`, error.message);
        failed++;
      } else {
        console.log(`✅ Migrated: ${file}`);
        success++;
      }
    } catch (err) {
      console.error(`❌ Error reading/parsing ${file}:`, err);
      failed++;
    }
  }

  console.log(`\nMigration complete. ${success} successful, ${failed} failed.`);
  console.log(`You can now delete the local 'auth_info_baileys' folder.`);
}

migrate();
