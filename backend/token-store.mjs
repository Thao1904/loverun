import path from "node:path";
import { fileURLToPath } from "node:url";
import { readStoredJson, writeStoredJson } from "./storage.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const tokensFile = path.resolve(
  rootDir,
  process.env.TOKENS_STORAGE_PATH ?? "./data/strava-tokens.json",
);
const tokensBlobPath = process.env.TOKENS_BLOB_PATH ?? "love-running/strava-tokens.json";

const supabaseUrl = process.env.SUPABASE_URL ?? "";
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const supabaseTable = process.env.SUPABASE_STRAVA_TOKENS_TABLE ?? "strava_tokens";

export async function getTokenEntry(athleteKey) {
  if (isSupabaseConfigured()) {
    const rows = await supabaseRequest(
      `${supabaseTable}?athlete_key=eq.${encodeURIComponent(athleteKey)}&select=*`,
      {
        method: "GET",
      },
    );

    return Array.isArray(rows) && rows.length > 0 ? mapSupabaseRowToToken(rows[0]) : null;
  }

  const store = await readFileTokenStore();
  return store[athleteKey] ?? null;
}

export async function setTokenEntry(athleteKey, entry) {
  if (isSupabaseConfigured()) {
    await supabaseRequest(`${supabaseTable}?on_conflict=athlete_key`, {
      method: "POST",
      headers: {
        Prefer: "resolution=merge-duplicates,return=representation",
      },
      body: JSON.stringify([mapTokenToSupabaseRow(athleteKey, entry)]),
    });
    return;
  }

  const store = await readFileTokenStore();
  store[athleteKey] = entry;
  await writeFileTokenStore(store);
}

export async function deleteTokenEntry(athleteKey) {
  if (isSupabaseConfigured()) {
    await supabaseRequest(`${supabaseTable}?athlete_key=eq.${encodeURIComponent(athleteKey)}`, {
      method: "DELETE",
    });
    return;
  }

  const store = await readFileTokenStore();
  delete store[athleteKey];
  await writeFileTokenStore(store);
}

function isSupabaseConfigured() {
  return Boolean(supabaseUrl && supabaseServiceRoleKey);
}

async function supabaseRequest(pathname, init) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${pathname}`, {
    ...init,
    headers: {
      apikey: supabaseServiceRoleKey,
      Authorization: `Bearer ${supabaseServiceRoleKey}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase token store request failed: ${text}`);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

async function readFileTokenStore() {
  return readStoredJson({
    blobPath: tokensBlobPath,
    filePath: tokensFile,
    fallback: {},
  });
}

async function writeFileTokenStore(value) {
  return writeStoredJson({
    blobPath: tokensBlobPath,
    filePath: tokensFile,
    value,
  });
}

function mapTokenToSupabaseRow(athleteKey, entry) {
  return {
    athlete_key: athleteKey,
    access_token: entry.accessToken,
    refresh_token: entry.refreshToken,
    expires_at: entry.expiresAt,
    scope: entry.scope ?? "",
    athlete_id: entry.athlete?.id ?? null,
    athlete_firstname: entry.athlete?.firstname ?? "",
    athlete_lastname: entry.athlete?.lastname ?? "",
    athlete_profile: entry.athlete?.profile ?? "",
    updated_at: entry.updatedAt ?? new Date().toISOString(),
  };
}

function mapSupabaseRowToToken(row) {
  return {
    athleteKey: row.athlete_key,
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    expiresAt: row.expires_at,
    scope: row.scope ?? "",
    athlete: row.athlete_id
      ? {
          id: row.athlete_id,
          firstname: row.athlete_firstname ?? "",
          lastname: row.athlete_lastname ?? "",
          profile: row.athlete_profile ?? "",
        }
      : null,
    updatedAt: row.updated_at ?? null,
  };
}
