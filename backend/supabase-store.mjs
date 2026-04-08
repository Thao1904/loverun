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
const stravaAppsTable = process.env.SUPABASE_STRAVA_APPS_TABLE ?? "strava_app_credentials";
const usersTable = process.env.SUPABASE_USERS_TABLE ?? "app_users";
const pairingsTable = process.env.SUPABASE_PAIRINGS_TABLE ?? "app_pairings";
const userStravaAppsTable = process.env.SUPABASE_USER_STRAVA_APPS_TABLE ?? "user_strava_apps";
const userStravaTokensTable = process.env.SUPABASE_USER_STRAVA_TOKENS_TABLE ?? "user_strava_tokens";
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

export async function readStravaAppConfigs() {
  if (isSupabaseConfigured()) {
    const rows = await supabaseRequest(`${stravaAppsTable}?select=*`, {
      method: "GET",
    });

    if (Array.isArray(rows)) {
      return rows.reduce(
        (result, row) => ({
          ...result,
          [row.athlete_key]: mapStravaAppRow(row),
        }),
        {},
      );
    }
  }

  const state = await readStoredJson({
    blobPath: appStateBlobPath,
    filePath: appStateFile,
    fallback: {},
  });

  return state.stravaApps ?? {};
}

export async function getStravaAppConfig(athleteKey) {
  if (isSupabaseConfigured()) {
    const rows = await supabaseRequest(
      `${stravaAppsTable}?athlete_key=eq.${encodeURIComponent(athleteKey)}&select=*`,
      {
        method: "GET",
      },
    );

    return Array.isArray(rows) && rows.length > 0 ? mapStravaAppRow(rows[0]) : null;
  }

  const state = await readStoredJson({
    blobPath: appStateBlobPath,
    filePath: appStateFile,
    fallback: {},
  });

  return state.stravaApps?.[athleteKey] ?? null;
}

export async function setStravaAppConfig(athleteKey, value) {
  const normalized = {
    athleteKey,
    clientId: String(value?.clientId ?? "").trim(),
    clientSecret: String(value?.clientSecret ?? "").trim(),
    redirectUri: String(value?.redirectUri ?? "").trim(),
    updatedAt: value?.updatedAt ?? new Date().toISOString(),
  };

  if (isSupabaseConfigured()) {
    await supabaseRequest(`${stravaAppsTable}?on_conflict=athlete_key`, {
      method: "POST",
      headers: {
        Prefer: "resolution=merge-duplicates,return=representation",
      },
      body: JSON.stringify([
        {
          athlete_key: athleteKey,
          client_id: normalized.clientId,
          client_secret: normalized.clientSecret,
          redirect_uri: normalized.redirectUri,
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
      stravaApps: {
        ...(state.stravaApps ?? {}),
        [athleteKey]: normalized,
      },
    },
  });

  return normalized;
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

export async function createUser(value) {
  const normalizedEmail = String(value?.email ?? "").trim().toLowerCase();
  const user = {
    id: value?.id,
    email: normalizedEmail,
    passwordHash: value?.passwordHash ?? "",
    passwordSalt: value?.passwordSalt ?? "",
    displayName: normalizeNickname(value?.displayName, normalizedEmail.split("@")[0] || "Runner"),
    createdAt: value?.createdAt ?? new Date().toISOString(),
    updatedAt: value?.updatedAt ?? new Date().toISOString(),
  };

  if (isSupabaseConfigured()) {
    const rows = await supabaseRequest(`${usersTable}?on_conflict=id`, {
      method: "POST",
      headers: {
        Prefer: "resolution=merge-duplicates,return=representation",
      },
      body: JSON.stringify([
        {
          id: user.id,
          email: user.email,
          password_hash: user.passwordHash,
          password_salt: user.passwordSalt,
          display_name: user.displayName,
          created_at: user.createdAt,
          updated_at: user.updatedAt,
        },
      ]),
    });

    return Array.isArray(rows) && rows.length > 0 ? mapUserRow(rows[0]) : user;
  }

  const state = await readStoredJson({
    blobPath: appStateBlobPath,
    filePath: appStateFile,
    fallback: {},
  });
  const users = state.users ?? [];
  users.push(user);
  await writeStoredJson({
    blobPath: appStateBlobPath,
    filePath: appStateFile,
    value: {
      ...state,
      users,
    },
  });
  return user;
}

export async function getUserByEmail(email) {
  const normalizedEmail = String(email ?? "").trim().toLowerCase();

  if (isSupabaseConfigured()) {
    const rows = await supabaseRequest(
      `${usersTable}?email=eq.${encodeURIComponent(normalizedEmail)}&select=*`,
      { method: "GET" },
    );
    return Array.isArray(rows) && rows.length > 0 ? mapUserRow(rows[0]) : null;
  }

  const state = await readStoredJson({
    blobPath: appStateBlobPath,
    filePath: appStateFile,
    fallback: {},
  });
  return (state.users ?? []).find((user) => user.email === normalizedEmail) ?? null;
}

export async function getUserById(userId) {
  if (!userId) {
    return null;
  }

  if (isSupabaseConfigured()) {
    const rows = await supabaseRequest(
      `${usersTable}?id=eq.${encodeURIComponent(userId)}&select=*`,
      { method: "GET" },
    );
    return Array.isArray(rows) && rows.length > 0 ? mapUserRow(rows[0]) : null;
  }

  const state = await readStoredJson({
    blobPath: appStateBlobPath,
    filePath: appStateFile,
    fallback: {},
  });
  return (state.users ?? []).find((user) => user.id === userId) ?? null;
}

export async function updateUserProfile(userId, value) {
  const existing = await getUserById(userId);

  if (!existing) {
    return null;
  }

  const nextUser = {
    ...existing,
    displayName: normalizeNickname(value?.displayName, existing.displayName),
    updatedAt: new Date().toISOString(),
  };

  if (isSupabaseConfigured()) {
    const rows = await supabaseRequest(`${usersTable}?id=eq.${encodeURIComponent(userId)}`, {
      method: "PATCH",
      headers: {
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        display_name: nextUser.displayName,
        updated_at: nextUser.updatedAt,
      }),
    });
    return Array.isArray(rows) && rows.length > 0 ? mapUserRow(rows[0]) : nextUser;
  }

  const state = await readStoredJson({
    blobPath: appStateBlobPath,
    filePath: appStateFile,
    fallback: {},
  });
  const users = (state.users ?? []).map((user) => (user.id === userId ? nextUser : user));
  await writeStoredJson({
    blobPath: appStateBlobPath,
    filePath: appStateFile,
    value: { ...state, users },
  });
  return nextUser;
}

export async function getPairingForUser(userId) {
  if (!userId) {
    return null;
  }

  if (isSupabaseConfigured()) {
    const ownerRows = await supabaseRequest(
      `${pairingsTable}?owner_user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc&limit=1&select=*`,
      { method: "GET" },
    );

    if (Array.isArray(ownerRows) && ownerRows.length > 0) {
      return mapPairingRow(ownerRows[0]);
    }

    const partnerRows = await supabaseRequest(
      `${pairingsTable}?partner_user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc&limit=1&select=*`,
      { method: "GET" },
    );

    return Array.isArray(partnerRows) && partnerRows.length > 0 ? mapPairingRow(partnerRows[0]) : null;
  }

  const state = await readStoredJson({
    blobPath: appStateBlobPath,
    filePath: appStateFile,
    fallback: {},
  });
  const pairings = state.userPairings ?? [];
  return pairings.find((pairing) => pairing.ownerUserId === userId || pairing.partnerUserId === userId) ?? null;
}

export async function upsertPairing(value) {
  const pairing = {
    id: value?.id,
    code: String(value?.code ?? "").trim().toUpperCase(),
    ownerUserId: value?.ownerUserId ?? null,
    partnerUserId: value?.partnerUserId ?? null,
    status: value?.status ?? "pending",
    goalKm: Number(value?.goalKm ?? defaultGoalKm),
    createdAt: value?.createdAt ?? new Date().toISOString(),
    pairedAt: value?.pairedAt ?? null,
    updatedAt: value?.updatedAt ?? new Date().toISOString(),
  };

  if (isSupabaseConfigured()) {
    const rows = await supabaseRequest(`${pairingsTable}?on_conflict=id`, {
      method: "POST",
      headers: {
        Prefer: "resolution=merge-duplicates,return=representation",
      },
      body: JSON.stringify([
        {
          id: pairing.id,
          code: pairing.code,
          owner_user_id: pairing.ownerUserId,
          partner_user_id: pairing.partnerUserId,
          status: pairing.status,
          goal_km: pairing.goalKm,
          created_at: pairing.createdAt,
          paired_at: pairing.pairedAt,
          updated_at: pairing.updatedAt,
        },
      ]),
    });
    return Array.isArray(rows) && rows.length > 0 ? mapPairingRow(rows[0]) : pairing;
  }

  const state = await readStoredJson({
    blobPath: appStateBlobPath,
    filePath: appStateFile,
    fallback: {},
  });
  const pairings = state.userPairings ?? [];
  const index = pairings.findIndex((item) => item.id === pairing.id);

  if (index >= 0) {
    pairings[index] = pairing;
  } else {
    pairings.push(pairing);
  }

  await writeStoredJson({
    blobPath: appStateBlobPath,
    filePath: appStateFile,
    value: { ...state, userPairings: pairings },
  });
  return pairing;
}

export async function findPairingByCode(code) {
  const normalizedCode = String(code ?? "").trim().toUpperCase();

  if (isSupabaseConfigured()) {
    const rows = await supabaseRequest(
      `${pairingsTable}?code=eq.${encodeURIComponent(normalizedCode)}&limit=1&select=*`,
      { method: "GET" },
    );
    return Array.isArray(rows) && rows.length > 0 ? mapPairingRow(rows[0]) : null;
  }

  const state = await readStoredJson({
    blobPath: appStateBlobPath,
    filePath: appStateFile,
    fallback: {},
  });
  return (state.userPairings ?? []).find((pairing) => pairing.code === normalizedCode) ?? null;
}

export async function getUserStravaAppConfig(userId) {
  if (!userId) {
    return null;
  }

  if (isSupabaseConfigured()) {
    const rows = await supabaseRequest(
      `${userStravaAppsTable}?user_id=eq.${encodeURIComponent(userId)}&select=*`,
      { method: "GET" },
    );
    return Array.isArray(rows) && rows.length > 0 ? mapUserStravaAppRow(rows[0]) : null;
  }

  const state = await readStoredJson({
    blobPath: appStateBlobPath,
    filePath: appStateFile,
    fallback: {},
  });
  return state.userStravaApps?.[userId] ?? null;
}

export async function setUserStravaAppConfig(userId, value) {
  const normalized = {
    userId,
    clientId: String(value?.clientId ?? "").trim(),
    clientSecret: String(value?.clientSecret ?? "").trim(),
    redirectUri: String(value?.redirectUri ?? "").trim(),
    updatedAt: value?.updatedAt ?? new Date().toISOString(),
  };

  if (isSupabaseConfigured()) {
    const rows = await supabaseRequest(`${userStravaAppsTable}?on_conflict=user_id`, {
      method: "POST",
      headers: {
        Prefer: "resolution=merge-duplicates,return=representation",
      },
      body: JSON.stringify([
        {
          user_id: userId,
          client_id: normalized.clientId,
          client_secret: normalized.clientSecret,
          redirect_uri: normalized.redirectUri,
          updated_at: normalized.updatedAt,
        },
      ]),
    });
    return Array.isArray(rows) && rows.length > 0 ? mapUserStravaAppRow(rows[0]) : normalized;
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
      userStravaApps: {
        ...(state.userStravaApps ?? {}),
        [userId]: normalized,
      },
    },
  });
  return normalized;
}

export async function getUserTokenEntry(userId) {
  if (!userId) {
    return null;
  }

  if (isSupabaseConfigured()) {
    const rows = await supabaseRequest(
      `${userStravaTokensTable}?user_id=eq.${encodeURIComponent(userId)}&select=*`,
      { method: "GET" },
    );
    return Array.isArray(rows) && rows.length > 0 ? mapUserTokenRow(rows[0]) : null;
  }

  const state = await readStoredJson({
    blobPath: appStateBlobPath,
    filePath: appStateFile,
    fallback: {},
  });
  return state.userStravaTokens?.[userId] ?? null;
}

export async function setUserTokenEntry(userId, entry) {
  const normalized = {
    userId,
    accessToken: entry.accessToken,
    refreshToken: entry.refreshToken,
    expiresAt: entry.expiresAt,
    scope: entry.scope ?? "",
    athlete: entry.athlete ?? null,
    updatedAt: entry.updatedAt ?? new Date().toISOString(),
  };

  if (isSupabaseConfigured()) {
    const rows = await supabaseRequest(`${userStravaTokensTable}?on_conflict=user_id`, {
      method: "POST",
      headers: {
        Prefer: "resolution=merge-duplicates,return=representation",
      },
      body: JSON.stringify([
        {
          user_id: userId,
          access_token: normalized.accessToken,
          refresh_token: normalized.refreshToken,
          expires_at: normalized.expiresAt,
          scope: normalized.scope,
          athlete_id: normalized.athlete?.id ?? null,
          athlete_firstname: normalized.athlete?.firstname ?? "",
          athlete_lastname: normalized.athlete?.lastname ?? "",
          athlete_profile: normalized.athlete?.profile ?? "",
          updated_at: normalized.updatedAt,
        },
      ]),
    });
    return Array.isArray(rows) && rows.length > 0 ? mapUserTokenRow(rows[0]) : normalized;
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
      userStravaTokens: {
        ...(state.userStravaTokens ?? {}),
        [userId]: normalized,
      },
    },
  });
  return normalized;
}

export async function deleteUserTokenEntry(userId) {
  if (!userId) {
    return;
  }

  if (isSupabaseConfigured()) {
    await supabaseRequest(`${userStravaTokensTable}?user_id=eq.${encodeURIComponent(userId)}`, {
      method: "DELETE",
    });
    return;
  }

  const state = await readStoredJson({
    blobPath: appStateBlobPath,
    filePath: appStateFile,
    fallback: {},
  });
  const next = { ...(state.userStravaTokens ?? {}) };
  delete next[userId];
  await writeStoredJson({
    blobPath: appStateBlobPath,
    filePath: appStateFile,
    value: {
      ...state,
      userStravaTokens: next,
    },
  });
}

function isSupabaseConfigured() {
  return Boolean(supabaseUrl && supabaseServiceRoleKey);
}

function normalizeNickname(value, fallback) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized.slice(0, 24) : fallback;
}

function mapStravaAppRow(row) {
  return {
    athleteKey: row.athlete_key,
    clientId: row.client_id ?? "",
    clientSecret: row.client_secret ?? "",
    redirectUri: row.redirect_uri ?? "",
    updatedAt: row.updated_at ?? null,
  };
}

function mapUserRow(row) {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    passwordSalt: row.password_salt,
    displayName: row.display_name ?? "Runner",
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

function mapPairingRow(row) {
  return {
    id: row.id,
    code: row.code,
    ownerUserId: row.owner_user_id,
    partnerUserId: row.partner_user_id ?? null,
    status: row.status ?? "pending",
    goalKm: Number(row.goal_km ?? defaultGoalKm),
    createdAt: row.created_at ?? null,
    pairedAt: row.paired_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

function mapUserStravaAppRow(row) {
  return {
    userId: row.user_id,
    clientId: row.client_id ?? "",
    clientSecret: row.client_secret ?? "",
    redirectUri: row.redirect_uri ?? "",
    updatedAt: row.updated_at ?? null,
  };
}

function mapUserTokenRow(row) {
  return {
    userId: row.user_id,
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
