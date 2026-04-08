import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createSessionToken, hashPassword, verifyPassword } from "./auth.mjs";
import {
  createUser,
  deleteTokenEntry,
  deleteUserTokenEntry,
  findPairingByCode,
  getStravaAppConfig,
  getTokenEntry,
  getUserByEmail,
  getUserById,
  getUserStravaAppConfig,
  getUserTokenEntry,
  getPairingForUser,
  readGoalState,
  readNicknameState,
  readPairingState,
  readStravaAppConfigs,
  setUserStravaAppConfig,
  setUserTokenEntry,
  setStravaAppConfig,
  setTokenEntry,
  updateUserProfile,
  upsertPairing,
  writeGoalState,
  writeNicknameState,
  writePairingState,
} from "./supabase-store.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

const runTypes = new Set(["Run", "TrailRun", "VirtualRun"]);

export const env = {
  timezone: process.env.APP_TIMEZONE ?? "America/New_York",
  defaultGoalKm: Number(process.env.DEFAULT_SHARED_GOAL_KM ?? 18),
  distDir: path.resolve(rootDir, "dist"),
};

export async function registerUser(payload) {
  const email = String(payload?.email ?? "").trim().toLowerCase();
  const password = String(payload?.password ?? "");
  const displayName = String(payload?.displayName ?? "").trim() || email.split("@")[0] || "Runner";

  if (!email || !password) {
    throw new Error("email and password are required.");
  }

  const existing = await getUserByEmail(email);

  if (existing) {
    throw new Error("An account with this email already exists.");
  }

  const { salt, hash } = hashPassword(password);
  const user = await createUser({
    id: crypto.randomUUID(),
    email,
    passwordHash: hash,
    passwordSalt: salt,
    displayName,
  });

  return createAuthPayload(user);
}

export async function loginUser(payload) {
  const email = String(payload?.email ?? "").trim().toLowerCase();
  const password = String(payload?.password ?? "");
  const user = await getUserByEmail(email);

  if (!user || !verifyPassword(password, user.passwordSalt, user.passwordHash)) {
    throw new Error("Invalid email or password.");
  }

  return createAuthPayload(user);
}

export async function getSessionUser(session) {
  if (!session?.sub) {
    return null;
  }

  const user = await getUserById(session.sub);
  return user ? toPublicUser(user) : null;
}

export async function getDashboardForUser(userId, date) {
  const resolvedDate = date ?? getTodayDateString(env.timezone);
  const [user, pairing] = await Promise.all([
    getUserById(userId),
    getPairingForUser(userId),
  ]);

  if (!user) {
    throw new Error("User not found.");
  }

  const partnerUserId = pairing
    ? pairing.ownerUserId === userId
      ? pairing.partnerUserId
      : pairing.ownerUserId
    : null;
  const partner = partnerUserId ? await getUserById(partnerUserId) : null;
  const selfSnapshot = await buildUserAthleteSnapshot(userId, "you", resolvedDate);
  const partnerSnapshot = partner ? await buildUserAthleteSnapshot(partner.id, "partner", resolvedDate) : emptyAthleteSnapshot("partner");
  const combinedDistanceKm = selfSnapshot.summary.distanceKm + partnerSnapshot.summary.distanceKm;
  const combinedCalories = selfSnapshot.summary.calories + partnerSnapshot.summary.calories;
  const combinedSteps = selfSnapshot.summary.steps + partnerSnapshot.summary.steps;
  const combinedHeartRate = weightedAverage([
    { value: selfSnapshot.summary.heartRateAvg, weight: selfSnapshot.summary.movingTime },
    { value: partnerSnapshot.summary.heartRateAvg, weight: partnerSnapshot.summary.movingTime },
  ]);
  const selfApp = await getUserStravaAppConfig(userId);
  const goalKm = pairing?.goalKm ?? env.defaultGoalKm;

  return {
    date: resolvedDate,
    currentUser: toPublicUser(user),
    goalKm,
    nicknames: {
      you: user.displayName,
      partner: partner?.displayName ?? "Partner",
      updatedAt: user.updatedAt ?? null,
    },
    pairing: {
      code: pairing?.code ?? null,
      paired: Boolean(pairing?.partnerUserId),
      createdAt: pairing?.createdAt ?? null,
      pairedAt: pairing?.pairedAt ?? null,
      partner: partner ? toPublicUser(partner) : null,
    },
    stravaApps: {
      you: toPublicStravaAppConfig(selfApp),
      partner: {
        configured: Boolean(partner),
        clientId: "",
        redirectUri: "",
        updatedAt: partner?.updatedAt ?? null,
      },
    },
    athletes: {
      you: selfSnapshot,
      partner: partnerSnapshot,
    },
    combined: {
      distanceKm: round(combinedDistanceKm),
      calories: Math.round(combinedCalories),
      steps: Math.round(combinedSteps),
      heartRateAvg: Math.round(combinedHeartRate),
      heartRateSeries: [
        ...selfSnapshot.summary.heartRateSeries,
        ...partnerSnapshot.summary.heartRateSeries,
      ].slice(0, 256),
    },
  };
}

export async function saveUserDisplayName(userId, payload) {
  const updated = await updateUserProfile(userId, {
    displayName: payload?.you,
  });

  if (!updated) {
    throw new Error("User not found.");
  }

  return {
    you: updated.displayName,
    partner: payload?.partner ?? "Partner",
    updatedAt: updated.updatedAt ?? null,
  };
}

export async function createPairingCodeForUser(userId) {
  const current = await getPairingForUser(userId);
  const code = generatePairingCode();
  const pairing = await upsertPairing({
    id: current?.id ?? crypto.randomUUID(),
    code,
    ownerUserId: current?.ownerUserId ?? userId,
    partnerUserId: null,
    status: "pending",
    goalKm: current?.goalKm ?? env.defaultGoalKm,
    createdAt: current?.createdAt ?? new Date().toISOString(),
    pairedAt: null,
    updatedAt: new Date().toISOString(),
  });

  return {
    code: pairing.code,
    paired: false,
    createdAt: pairing.createdAt,
    pairedAt: null,
    partner: null,
  };
}

export async function joinPairingCodeForUser(userId, inputCode) {
  const normalizedCode = String(inputCode ?? "").trim().toUpperCase();

  if (!normalizedCode) {
    throw new Error("Pairing code is required.");
  }

  const pairing = await findPairingByCode(normalizedCode);

  if (!pairing || pairing.ownerUserId === userId) {
    throw new Error("Invalid pairing code.");
  }

  const updated = await upsertPairing({
    ...pairing,
    partnerUserId: userId,
    status: "paired",
    pairedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const partner = await getUserById(updated.ownerUserId);
  return {
    code: updated.code,
    paired: true,
    createdAt: updated.createdAt,
    pairedAt: updated.pairedAt,
    partner: partner ? toPublicUser(partner) : null,
  };
}

export async function saveGoalForUser(userId, goalKm) {
  const normalizedGoal = Number(goalKm);

  if (!Number.isFinite(normalizedGoal) || normalizedGoal <= 0) {
    throw new Error("goalKm must be a positive number.");
  }

  const pairing = await getPairingForUser(userId);

  if (pairing) {
    const updated = await upsertPairing({
      ...pairing,
      goalKm: roundToHalf(normalizedGoal),
      updatedAt: new Date().toISOString(),
    });
    return { goalKm: updated.goalKm, updatedAt: updated.updatedAt };
  }

  return { goalKm: roundToHalf(normalizedGoal), updatedAt: new Date().toISOString() };
}

export async function saveUserStravaAppCredentials(userId, payload) {
  const clientId = String(payload?.clientId ?? "").trim();
  const clientSecret = String(payload?.clientSecret ?? "").trim();
  const redirectUri = String(payload?.redirectUri ?? "").trim();

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("clientId, clientSecret, and redirectUri are required.");
  }

  const saved = await setUserStravaAppConfig(userId, {
    clientId,
    clientSecret,
    redirectUri,
    updatedAt: new Date().toISOString(),
  });

  return toPublicStravaAppConfig(saved);
}

export async function exchangeCodeForUser(userId, { code, scope }) {
  const stravaApp = await getRequiredUserStravaAppConfig(userId);

  if (!code) {
    throw new Error("code is required.");
  }

  const tokenPayload = new URLSearchParams({
    client_id: stravaApp.clientId,
    client_secret: stravaApp.clientSecret,
    code,
    grant_type: "authorization_code",
  });

  const tokenResponse = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: tokenPayload,
  });

  if (!tokenResponse.ok) {
    throw new Error(await readStravaFault(tokenResponse));
  }

  const tokenData = await tokenResponse.json();
  await setUserTokenEntry(userId, {
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    expiresAt: tokenData.expires_at,
    scope: typeof scope === "string" ? scope : "",
    athlete: tokenData.athlete
      ? {
          id: tokenData.athlete.id,
          firstname: tokenData.athlete.firstname ?? "",
          lastname: tokenData.athlete.lastname ?? "",
          profile: tokenData.athlete.profile ?? "",
        }
      : null,
    updatedAt: new Date().toISOString(),
  });

  return { ok: true };
}

export async function disconnectUserStrava(userId) {
  await deleteUserTokenEntry(userId);
  return { ok: true };
}

export async function getDashboard(date) {
  const resolvedDate = date ?? getTodayDateString(env.timezone);
  const [appState, pairing, nicknames, stravaApps] = await Promise.all([
    readGoalState(),
    readPairingState(),
    readNicknameState(),
    readStravaAppConfigs(),
  ]);
  const athletes = {
    you: await buildAthleteSnapshot("you", resolvedDate),
    partner: await buildAthleteSnapshot("partner", resolvedDate),
  };

  const combinedDistanceKm = athletes.you.summary.distanceKm + athletes.partner.summary.distanceKm;
  const combinedCalories = athletes.you.summary.calories + athletes.partner.summary.calories;
  const combinedSteps = athletes.you.summary.steps + athletes.partner.summary.steps;
  const combinedHeartRate = weightedAverage([
    {
      value: athletes.you.summary.heartRateAvg,
      weight: athletes.you.summary.movingTime,
    },
    {
      value: athletes.partner.summary.heartRateAvg,
      weight: athletes.partner.summary.movingTime,
    },
  ]);

  return {
    date: resolvedDate,
    goalKm: appState.goalKm,
    pairing,
    nicknames,
    stravaApps: {
      you: toPublicStravaAppConfig(stravaApps.you),
      partner: toPublicStravaAppConfig(stravaApps.partner),
    },
    athletes,
    combined: {
      distanceKm: round(combinedDistanceKm),
      calories: Math.round(combinedCalories),
      steps: Math.round(combinedSteps),
      heartRateAvg: Math.round(combinedHeartRate),
      heartRateSeries: [
        ...athletes.you.summary.heartRateSeries,
        ...athletes.partner.summary.heartRateSeries,
      ].slice(0, 256),
    },
  };
}

export async function saveStravaAppCredentials(payload) {
  const athleteKey = normalizeAthleteKey(payload?.athleteKey);
  const clientId = String(payload?.clientId ?? "").trim();
  const clientSecret = String(payload?.clientSecret ?? "").trim();
  const redirectUri = String(payload?.redirectUri ?? "").trim();

  if (!athleteKey) {
    throw new Error("athleteKey is required.");
  }

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("clientId, clientSecret, and redirectUri are required.");
  }

  const saved = await setStravaAppConfig(athleteKey, {
    clientId,
    clientSecret,
    redirectUri,
    updatedAt: new Date().toISOString(),
  });

  return toPublicStravaAppConfig(saved);
}

export async function saveNicknames(nicknames) {
  return writeNicknameState({
    you: nicknames?.you,
    partner: nicknames?.partner,
    updatedAt: new Date().toISOString(),
  });
}

export async function createPairingCode() {
  const code = generatePairingCode();
  const pairing = {
    code,
    paired: false,
    createdAt: new Date().toISOString(),
    pairedAt: null,
  };

  await writePairingState(pairing);
  return pairing;
}

export async function joinPairingCode(inputCode) {
  const normalizedCode = String(inputCode ?? "").trim().toUpperCase();

  if (!normalizedCode) {
    throw new Error("Pairing code is required.");
  }

  const current = await readPairingState();

  if (!current.code || current.code !== normalizedCode) {
    throw new Error("Invalid pairing code.");
  }

  const pairing = {
    ...current,
    paired: true,
    pairedAt: new Date().toISOString(),
  };

  await writePairingState(pairing);
  return pairing;
}

export async function saveGoal(goalKm) {
  const normalizedGoal = Number(goalKm);

  if (!Number.isFinite(normalizedGoal) || normalizedGoal <= 0) {
    throw new Error("goalKm must be a positive number.");
  }

  const nextState = {
    goalKm: roundToHalf(normalizedGoal),
    updatedAt: new Date().toISOString(),
  };

  await writeGoalState(nextState);
  return nextState;
}

export async function exchangeCode({ athleteKey, code, scope }) {
  const normalizedAthleteKey = normalizeAthleteKey(athleteKey);

  if (!normalizedAthleteKey || !code) {
    throw new Error("athleteKey and code are required.");
  }

  const stravaApp = await getRequiredStravaAppConfig(normalizedAthleteKey);

  const tokenPayload = new URLSearchParams({
    client_id: stravaApp.clientId,
    client_secret: stravaApp.clientSecret,
    code,
    grant_type: "authorization_code",
  });

  const tokenResponse = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: tokenPayload,
  });

  if (!tokenResponse.ok) {
    throw new Error(await readStravaFault(tokenResponse));
  }

  const tokenData = await tokenResponse.json();
  await setTokenEntry(normalizedAthleteKey, {
    athleteKey: normalizedAthleteKey,
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    expiresAt: tokenData.expires_at,
    scope: typeof scope === "string" ? scope : "",
    athlete: tokenData.athlete
      ? {
          id: tokenData.athlete.id,
          firstname: tokenData.athlete.firstname ?? "",
          lastname: tokenData.athlete.lastname ?? "",
          profile: tokenData.athlete.profile ?? "",
        }
      : null,
    updatedAt: new Date().toISOString(),
  });
  return { ok: true, athleteKey: normalizedAthleteKey };
}

export async function disconnectAthlete(athleteKey) {
  const normalizedAthleteKey = normalizeAthleteKey(athleteKey);

  if (!normalizedAthleteKey) {
    throw new Error("athleteKey is required.");
  }

  await deleteTokenEntry(normalizedAthleteKey);
  return { ok: true };
}

export function normalizeAthleteKey(value) {
  return value === "you" || value === "partner" ? value : null;
}

export function getContentType(filePath) {
  if (filePath.endsWith(".html")) {
    return "text/html; charset=utf-8";
  }

  if (filePath.endsWith(".js")) {
    return "text/javascript; charset=utf-8";
  }

  if (filePath.endsWith(".css")) {
    return "text/css; charset=utf-8";
  }

  if (filePath.endsWith(".json")) {
    return "application/json; charset=utf-8";
  }

  if (filePath.endsWith(".svg")) {
    return "image/svg+xml";
  }

  return "application/octet-stream";
}

async function buildAthleteSnapshot(athleteKey, date) {
  const storedToken = await getTokenEntry(athleteKey);

  if (!storedToken) {
    return {
      athleteKey,
      connected: false,
      athlete: null,
      summary: emptySummary(),
    };
  }

  try {
    const accessToken = await ensureAccessToken(athleteKey);
    const athlete = await stravaGet("/api/v3/athlete", accessToken);
    const activities = await listRunningActivities(accessToken, date);
    const details = await Promise.all(
      activities.map((activity) => stravaGet(`/api/v3/activities/${activity.id}`, accessToken)),
    );
    const heartRateSeries = await collectHeartRateSeries(details, accessToken);

    return {
      athleteKey,
      connected: true,
      athlete: {
        id: athlete.id,
        firstname: athlete.firstname ?? storedToken.athlete?.firstname ?? "",
        lastname: athlete.lastname ?? storedToken.athlete?.lastname ?? "",
        profile: athlete.profile ?? athlete.profile_medium ?? storedToken.athlete?.profile ?? "",
      },
      summary: summarizeActivities(details, heartRateSeries),
    };
  } catch (error) {
    return {
      athleteKey,
      connected: false,
      athlete: storedToken.athlete ?? null,
      error: error instanceof Error ? error.message : "Failed to fetch athlete data.",
      summary: emptySummary(),
    };
  }
}

async function buildUserAthleteSnapshot(userId, athleteKey, date) {
  const storedToken = await getUserTokenEntry(userId);

  if (!storedToken) {
    return emptyAthleteSnapshot(athleteKey);
  }

  try {
    const accessToken = await ensureAccessTokenForUser(userId);
    const athlete = await stravaGet("/api/v3/athlete", accessToken);
    const activities = await listRunningActivities(accessToken, date);
    const details = await Promise.all(
      activities.map((activity) => stravaGet(`/api/v3/activities/${activity.id}`, accessToken)),
    );
    const heartRateSeries = await collectHeartRateSeries(details, accessToken);

    return {
      athleteKey,
      connected: true,
      athlete: {
        id: athlete.id,
        firstname: athlete.firstname ?? storedToken.athlete?.firstname ?? "",
        lastname: athlete.lastname ?? storedToken.athlete?.lastname ?? "",
        profile: athlete.profile ?? athlete.profile_medium ?? storedToken.athlete?.profile ?? "",
      },
      summary: summarizeActivities(details, heartRateSeries),
    };
  } catch (error) {
    return {
      athleteKey,
      connected: false,
      athlete: storedToken.athlete ?? null,
      error: error instanceof Error ? error.message : "Failed to fetch athlete data.",
      summary: emptySummary(),
    };
  }
}

async function collectHeartRateSeries(activities, accessToken) {
  const heartRateChunks = [];

  for (const activity of activities.slice(0, 3)) {
    try {
      const stream = await stravaGet(
        `/api/v3/activities/${activity.id}/streams?keys=heartrate&key_by_type=true`,
        accessToken,
      );
      const data = stream?.heartrate?.data;

      if (Array.isArray(data)) {
        heartRateChunks.push(...data.slice(0, 96));
      }
    } catch (error) {
      console.warn(`Could not fetch heartrate stream for activity ${activity.id}`, error);
    }
  }

  return heartRateChunks.slice(0, 256);
}

async function listRunningActivities(accessToken, date) {
  const { afterUnix, beforeUnix } = getDayBounds(date, env.timezone);
  const activities = await stravaGet(
    `/api/v3/athlete/activities?after=${afterUnix}&before=${beforeUnix}&page=1&per_page=100`,
    accessToken,
  );

  if (!Array.isArray(activities)) {
    return [];
  }

  return activities.filter((activity) => runTypes.has(activity.type));
}

function summarizeActivities(activities, heartRateSeries) {
  if (activities.length === 0) {
    return emptySummary();
  }

  const distanceKm = activities.reduce((sum, activity) => sum + (activity.distance ?? 0) / 1000, 0);
  const calories = activities.reduce((sum, activity) => sum + (activity.calories ?? 0), 0);
  const steps = activities.reduce((sum, activity) => sum + estimateSteps(activity), 0);
  const movingTime = activities.reduce((sum, activity) => sum + (activity.moving_time ?? 0), 0);
  const heartRateAvg = weightedAverage(
    activities.map((activity) => ({
      value: activity.average_heartrate ?? 0,
      weight: activity.moving_time ?? 0,
    })),
  );

  return {
    distanceKm: round(distanceKm),
    calories: Math.round(calories),
    steps: Math.round(steps),
    heartRateAvg: Math.round(heartRateAvg),
    movingTime,
    activitiesCount: activities.length,
    heartRateSeries,
    stepSource: "estimated_from_cadence",
  };
}

function estimateSteps(activity) {
  const movingTime = Number(activity.moving_time ?? 0);
  const averageCadence = Number(activity.average_cadence ?? 0);

  if (!movingTime || !averageCadence) {
    return 0;
  }

  return averageCadence * 2 * (movingTime / 60);
}

async function ensureAccessToken(athleteKey) {
  const tokenEntry = await getTokenEntry(athleteKey);

  if (!tokenEntry) {
    throw new Error("No token found for athlete.");
  }

  const expiresSoon = Number(tokenEntry.expiresAt ?? 0) - Math.floor(Date.now() / 1000) < 3600;

  if (!expiresSoon) {
    return tokenEntry.accessToken;
  }

  const stravaApp = await getRequiredStravaAppConfig(athleteKey);

  const refreshPayload = new URLSearchParams({
    client_id: stravaApp.clientId,
    client_secret: stravaApp.clientSecret,
    grant_type: "refresh_token",
    refresh_token: tokenEntry.refreshToken,
  });

  const refreshResponse = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: refreshPayload,
  });

  if (!refreshResponse.ok) {
    throw new Error(await readStravaFault(refreshResponse));
  }

  const refreshed = await refreshResponse.json();
  const nextEntry = {
    ...tokenEntry,
    accessToken: refreshed.access_token,
    refreshToken: refreshed.refresh_token,
    expiresAt: refreshed.expires_at,
    updatedAt: new Date().toISOString(),
  };

  await setTokenEntry(athleteKey, nextEntry);
  return refreshed.access_token;
}

async function ensureAccessTokenForUser(userId) {
  const tokenEntry = await getUserTokenEntry(userId);

  if (!tokenEntry) {
    throw new Error("No token found for user.");
  }

  const expiresSoon = Number(tokenEntry.expiresAt ?? 0) - Math.floor(Date.now() / 1000) < 3600;

  if (!expiresSoon) {
    return tokenEntry.accessToken;
  }

  const stravaApp = await getRequiredUserStravaAppConfig(userId);
  const refreshPayload = new URLSearchParams({
    client_id: stravaApp.clientId,
    client_secret: stravaApp.clientSecret,
    grant_type: "refresh_token",
    refresh_token: tokenEntry.refreshToken,
  });

  const refreshResponse = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: refreshPayload,
  });

  if (!refreshResponse.ok) {
    throw new Error(await readStravaFault(refreshResponse));
  }

  const refreshed = await refreshResponse.json();
  const nextEntry = {
    ...tokenEntry,
    accessToken: refreshed.access_token,
    refreshToken: refreshed.refresh_token,
    expiresAt: refreshed.expires_at,
    updatedAt: new Date().toISOString(),
  };

  await setUserTokenEntry(userId, nextEntry);
  return refreshed.access_token;
}

async function stravaGet(endpoint, accessToken) {
  const response = await fetch(`https://www.strava.com${endpoint}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(await readStravaFault(response));
  }

  return response.json();
}

async function readStravaFault(response) {
  try {
    const json = await response.json();
    return json?.message ?? `Strava request failed with status ${response.status}.`;
  } catch {
    return `Strava request failed with status ${response.status}.`;
  }
}

function getTodayDateString(timezone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function getDayBounds(dateString, timezone) {
  const utcStart = zonedTimeToUtc(dateString, timezone, "00:00:00");
  const utcEnd = zonedTimeToUtc(dateString, timezone, "23:59:59");
  return {
    afterUnix: Math.floor(utcStart.getTime() / 1000),
    beforeUnix: Math.floor(utcEnd.getTime() / 1000),
  };
}

function zonedTimeToUtc(dateString, timezone, timeString) {
  const [year, month, day] = dateString.split("-").map(Number);
  const [hours, minutes, seconds] = timeString.split(":").map(Number);
  const utcDate = new Date(Date.UTC(year, month - 1, day, hours, minutes, seconds));
  const offsetMinutes = getTimeZoneOffsetMinutes(utcDate, timezone);
  return new Date(utcDate.getTime() - offsetMinutes * 60_000);
}

function getTimeZoneOffsetMinutes(date, timezone) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const asUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second),
  );

  return (asUtc - date.getTime()) / 60_000;
}

function weightedAverage(items) {
  const validItems = items.filter((item) => item.value > 0 && item.weight > 0);

  if (validItems.length === 0) {
    return 0;
  }

  const weightedSum = validItems.reduce((sum, item) => sum + item.value * item.weight, 0);
  const totalWeight = validItems.reduce((sum, item) => sum + item.weight, 0);
  return weightedSum / totalWeight;
}

function round(value) {
  return Math.round(value * 10) / 10;
}

function roundToHalf(value) {
  return Math.round(value * 2) / 2;
}

function emptySummary() {
  return {
    distanceKm: 0,
    calories: 0,
    steps: 0,
    heartRateAvg: 0,
    movingTime: 0,
    activitiesCount: 0,
    heartRateSeries: [],
    stepSource: "estimated_from_cadence",
  };
}

function emptyAthleteSnapshot(athleteKey) {
  return {
    athleteKey,
    connected: false,
    athlete: null,
    summary: emptySummary(),
  };
}

function generatePairingCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
}

async function getRequiredStravaAppConfig(athleteKey) {
  const config = await getStravaAppConfig(athleteKey);

  if (!config?.clientId || !config?.clientSecret || !config?.redirectUri) {
    throw new Error(`Missing Strava app credentials for ${athleteKey}.`);
  }

  return config;
}

async function getRequiredUserStravaAppConfig(userId) {
  const config = await getUserStravaAppConfig(userId);

  if (!config?.clientId || !config?.clientSecret || !config?.redirectUri) {
    throw new Error("Missing Strava app credentials for this user.");
  }

  return config;
}

function toPublicStravaAppConfig(config) {
  return {
    configured: Boolean(config?.clientId && config?.redirectUri),
    clientId: config?.clientId ?? "",
    redirectUri: config?.redirectUri ?? "",
    updatedAt: config?.updatedAt ?? null,
  };
}

function toPublicUser(user) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    createdAt: user.createdAt ?? null,
    updatedAt: user.updatedAt ?? null,
  };
}

function createAuthPayload(user) {
  return {
    user: toPublicUser(user),
    token: createSessionToken(toPublicUser(user)),
  };
}
