import path from "node:path";
import { fileURLToPath } from "node:url";
import { deleteTokenEntry, getTokenEntry, readGoalState, setTokenEntry, writeGoalState } from "./supabase-store.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

const runTypes = new Set(["Run", "TrailRun", "VirtualRun"]);

export const env = {
  clientId: process.env.VITE_STRAVA_CLIENT_ID ?? process.env.STRAVA_CLIENT_ID ?? "",
  clientSecret: process.env.STRAVA_CLIENT_SECRET ?? "",
  timezone: process.env.APP_TIMEZONE ?? "America/New_York",
  defaultGoalKm: Number(process.env.DEFAULT_SHARED_GOAL_KM ?? 18),
  distDir: path.resolve(rootDir, "dist"),
};

export async function getDashboard(date) {
  const resolvedDate = date ?? getTodayDateString(env.timezone);
  const appState = await readGoalState();
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
  if (!env.clientId || !env.clientSecret) {
    throw new Error("Missing STRAVA credentials on the backend.");
  }

  const normalizedAthleteKey = normalizeAthleteKey(athleteKey);

  if (!normalizedAthleteKey || !code) {
    throw new Error("athleteKey and code are required.");
  }

  const tokenPayload = new URLSearchParams({
    client_id: env.clientId,
    client_secret: env.clientSecret,
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

  if (!env.clientId || !env.clientSecret) {
    throw new Error("Missing STRAVA backend credentials.");
  }

  const refreshPayload = new URLSearchParams({
    client_id: env.clientId,
    client_secret: env.clientSecret,
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
