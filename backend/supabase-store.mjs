import path from "node:path";
import { fileURLToPath } from "node:url";
import { readStoredJson, writeStoredJson } from "./storage.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const tokensFile = path.resolve(
  rootDir,
  process.env.TOKENS_STORAGE_PATH ?? "./data/strava-tokens.json",
);
const appStateFile = path.resolve(
  rootDir,
  process.env.APP_STATE_STORAGE_PATH ?? "./data/app-state.json",
);
const tokensBlobPath = process.env.TOKENS_BLOB_PATH ?? "love-running/strava-tokens.json";
const appStateBlobPath = process.env.APP_STATE_BLOB_PATH ?? "love-running/app-state.json";

const defaultGoalKm = Number(process.env.DEFAULT_SHARED_GOAL_KM ?? 18);
const supabaseUrl = process.env.SUPABASE_URL ?? "";
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const tokensTable = process.env.SUPABASE_STRAVA_TOKENS_TABLE ?? "strava_tokens";
const settingsTable = process.env.SUPABASE_SETTINGS_TABLE ?? "app_settings";
const defaultNicknames = {
  you: "You",
  partner: "Partner",
};

export async function readGoalState() {
  if (isSupabaseConfigured()) {
    const rows = await supabaseRequest(
      `${settingsTable}?key=eq.shared_goal&select=*`,
      { method: "GET" },
    );

    if (Array.isArray(rows) && rows.length > 0) {
      const row = rows[0];
      const goalKm = Number(row.value?.goalKm);

      return {
        goalKm: Number.isFinite(goalKm) && goalKm > 0 ? goalKm : defaultGoalKm,
        updatedAt: row.updated_at ?? null,
      };
    }
  }

  return readStoredJson({
    blobPath: appStateBlobPath,
    filePath: appStateFile,
    fallback: {
      goalKm: defaultGoalKm,
      updatedAt: null,
    },
  });
}

export async function readNicknameState() {
  if (isSupabaseConfigured()) {
    const rows = await supabaseRequest(
      `${settingsTable}?key=eq.nicknames&select=*`,
      { method: "GET" },
    );

    if (Array.isArray(rows) && rows.length > 0) {
      const row = rows[0];
      return {
        you: normalizeNickname(row.value?.you, defaultNicknames.you),
        partner: normalizeNickname(row.value?.partner, defaultNicknames.partner),
        updatedAt: row.updated_at ?? null,
      };
    }
  }

  const state = await readStoredJson({
    blobPath: appStateBlobPath,
    filePath: appStateFile,
    fallback: {},
  });

  return {
    you: normalizeNickname(state.nicknames?.you, defaultNicknames.you),
    partner: normalizeNickname(state.nicknames?.partner, defaultNicknames.partner),
    updatedAt: state.nicknames?.updatedAt ?? null,
  };
}

export async function writeNicknameState(value) {
  const normalized = {
    you: normalizeNickname(value?.you, defaultNicknames.you),
    partner: normalizeNickname(value?.partner, defaultNicknames.partner),
    updatedAt: value?.updatedAt ?? new Date().toISOString(),
  };

  if (isSupabaseConfigured()) {
    await supabaseRequest(`${settingsTable}?on_conflict=key`, {
      method: "POST",
      headers: {
        Prefer: "resolution=merge-duplicates,return=representation",
      },
      body: JSON.stringify([
        {
          key: "nicknames",
          value: {
            you: normalized.you,
            partner: normalized.partner,
          },
          updated_at: normalized.updatedAt,
        },
      ]),
    });
    return normalized;
  }

  const state = await readStoredJson({
    blobPath: appStateBlobPath,
    filePath: appStateFile,
    fallback: {},
  });

  await writeStoredJson({
    blobPath: appStateBlobPath,
    filePath: appStateFile,
    value: {
      ...state,
      nicknames: normalized,
    },
  });

  return normalized;
}

export async function writeGoalState(value) {
  if (isSupabaseConfigured()) {
    await supabaseRequest(`${settingsTable}?on_conflict=key`, {
      method: "POST",
      headers: {
        Prefer: "resolution=merge-duplicates,return=representation",
      },
      body: JSON.stringify([
        {
          key: "shared_goal",
          value: {
            goalKm: value.goalKm,
          },
          updated_at: value.updatedAt ?? new Date().toISOString(),
        },
      ]),
    });
    return;
  }

  return writeStoredJson({
    blobPath: appStateBlobPath,
    filePath: appStateFile,
    value,
  });
}

export async function readPairingState() {
  if (isSupabaseConfigured()) {
    const rows = await supabaseRequest(
      `${settingsTable}?key=eq.pairing&select=*`,
      { method: "GET" },
    );

    if (Array.isArray(rows) && rows.length > 0) {
      const row = rows[0];
      return {
        code: row.value?.code ?? null,
        paired: Boolean(row.value?.paired),
        createdAt: row.value?.createdAt ?? null,
        pairedAt: row.value?.pairedAt ?? null,
      };
    }
  }

  const state = await readStoredJson({
    blobPath: appStateBlobPath,
    filePath: appStateFile,
    fallback: {},
  });

  return state.pairing ?? {
    code: null,
    paired: false,
    createdAt: null,
    pairedAt: null,
  };
}

export async function writePairingState(value) {
  if (isSupabaseConfigured()) {
    await supabaseRequest(`${settingsTable}?on_conflict=key`, {
      method: "POST",
      headers: {
        Prefer: "resolution=merge-duplicates,return=representation",
      },
      body: JSON.stringify([
        {
          key: "pairing",
          value,
          updated_at: value.pairedAt ?? value.createdAt ?? new Date().toISOString(),
        },
      ]),
    });
    return;
  }

  const state = await readStoredJson({
    blobPath: appStateBlobPath,
    filePath: appStateFile,
    fallback: {},
  });

  await writeStoredJson({
    blobPath: appStateBlobPath,
    filePath: appStateFile,
    value: {
      ...state,
      pairing: value,
    },
  });
}

export async function getTokenEntry(athleteKey) {
  if (isSupabaseConfigured()) {
    const rows = await supabaseRequest(
      `${tokensTable}?athlete_key=eq.${encodeURIComponent(athleteKey)}&select=*`,
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
    await supabaseRequest(`${tokensTable}?on_conflict=athlete_key`, {
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
    await supabaseRequest(`${tokensTable}?athlete_key=eq.${encodeURIComponent(athleteKey)}`, {
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

function normalizeNickname(value, fallback) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized.slice(0, 24) : fallback;
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
    throw new Error(`Supabase request failed: ${text}`);
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
