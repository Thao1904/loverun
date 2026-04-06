export type AthleteKey = "you" | "partner";

export type AthleteSummary = {
  distanceKm: number;
  calories: number;
  steps: number;
  heartRateAvg: number;
  movingTime: number;
  activitiesCount: number;
  heartRateSeries: number[];
  stepSource: "estimated_from_cadence";
};

export type AthleteSnapshot = {
  athleteKey: AthleteKey;
  connected: boolean;
  athlete: {
    id: number;
    firstname: string;
    lastname: string;
    profile: string;
  } | null;
  error?: string;
  summary: AthleteSummary;
};

export type DashboardResponse = {
  date: string;
  goalKm: number;
  nicknames: {
    you: string;
    partner: string;
    updatedAt: string | null;
  };
  pairing: {
    code: string | null;
    paired: boolean;
    createdAt: string | null;
    pairedAt: string | null;
  };
  athletes: Record<AthleteKey, AthleteSnapshot>;
  combined: {
    distanceKm: number;
    calories: number;
    steps: number;
    heartRateAvg: number;
    heartRateSeries: number[];
  };
};

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

export async function fetchDashboard(date?: string): Promise<DashboardResponse> {
  const query = date ? `?date=${encodeURIComponent(date)}` : "";
  return requestJson<DashboardResponse>(`${apiBaseUrl}/api/dashboard${query}`);
}

export async function exchangeStravaCode(payload: {
  athleteKey: AthleteKey;
  code: string;
  scope: string;
}) {
  return requestJson(`${apiBaseUrl}/api/strava/exchange`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function disconnectAthlete(athleteKey: AthleteKey) {
  return requestJson(`${apiBaseUrl}/api/strava/disconnect`, {
    method: "POST",
    body: JSON.stringify({ athleteKey }),
  });
}

export async function saveSharedGoal(goalKm: number) {
  return requestJson<{ goalKm: number; updatedAt: string }>(`${apiBaseUrl}/api/goal`, {
    method: "PUT",
    body: JSON.stringify({ goalKm }),
  });
}

export async function saveNicknames(payload: { you: string; partner: string }) {
  return requestJson<DashboardResponse["nicknames"]>(`${apiBaseUrl}/api/nicknames`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function createPairingCode() {
  return requestJson<DashboardResponse["pairing"]>(`${apiBaseUrl}/api/pairing/create`, {
    method: "POST",
  });
}

export async function joinPairingCode(code: string) {
  return requestJson<DashboardResponse["pairing"]>(`${apiBaseUrl}/api/pairing/join`, {
    method: "POST",
    body: JSON.stringify({ code }),
  });
}

async function requestJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  const json = await response.json();

  if (!response.ok) {
    throw new Error(json?.error ?? "Request failed.");
  }

  return json as T;
}
