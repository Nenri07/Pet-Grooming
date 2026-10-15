/**
 * _load-env - side-effect module that loads KEY=VALUE pairs from the
 * project .env into process.env for standalone scripts (npx tsx scripts/..).
 *
 * Next.js auto-loads .env for the app, but a bare tsx run does not, so DB
 * scripts failed with 'MONGODB_URI is not defined'. Import this FIRST (before
 * any module that reads env at load time, e.g. @/lib/db/connect) so the vars
 * exist by the time those modules evaluate. Zero dependencies; only sets
 * keys that are not already present (real env wins over the file).
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

function loadEnvFile(file: string): void {
  if (!existsSync(file)) return;
  const raw = readFileSync(file, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    // Strip surrounding single or double quotes.
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key && process.env[key] === undefined) {
      process.env[key] = val;
    }
  }
}

// Load .env then .env.local (local overrides take precedence for keys the
// first file did not already set).
loadEnvFile(resolve(process.cwd(), '.env'));
loadEnvFile(resolve(process.cwd(), '.env.local'));
