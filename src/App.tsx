import { useEffect, useMemo, useRef, useState } from "react";
import { createHeartbeatSongController, type HeartbeatSongController } from "./audio";
import {
  disconnectAthlete,
  exchangeStravaCode,
  fetchDashboard,
  saveSharedGoal,
  type AthleteKey,
  type DashboardResponse,
} from "./api";
import {
  defaultGoalKm,
  languageCopy,
  stravaScopes,
  type Copy,
  type Language,
} from "./content";

type DashboardMetrics = {
  distanceKm: number;
  heartRateAvg: number;
  steps: number;
  calories: number;
  activitiesCount: number;
};

function App() {
  const initialLanguage = getInitialLanguage();
  const [language, setLanguage] = useState<Language>(initialLanguage);
  const [goalKm, setGoalKm] = useState(defaultGoalKm);
  const [savedGoalKm, setSavedGoalKm] = useState(defaultGoalKm);
  const [isSavingGoal, setIsSavingGoal] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [authState, setAuthState] = useState<"idle" | "connected" | "error">("idle");
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const songControllerRef = useRef<HeartbeatSongController | null>(null);

  const copy = languageCopy[language];

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  useEffect(() => {
    void loadDashboard();
  }, []);

  useEffect(() => {
    return () => {
      songControllerRef.current?.stop();
    };
  }, []);

  useEffect(() => {
    void handleStravaCallback();
  }, []);

  const dashboardData = useMemo(() => {
    const combined = dashboard?.combined ?? {
      distanceKm: 0,
      calories: 0,
      steps: 0,
      heartRateAvg: 0,
      heartRateSeries: [],
    };

    return {
      totalKm: combined.distanceKm,
      completion: Math.min(combined.distanceKm / goalKm, 1),
      steps: combined.steps,
      calories: combined.calories,
      heartRateAvg: combined.heartRateAvg,
      heartRateSeries: combined.heartRateSeries,
    };
  }, [dashboard, goalKm]);

  const songReady = dashboardData.completion >= 1 && dashboardData.heartRateSeries.length > 0;

  useEffect(() => {
    if (!songReady || !soundEnabled) {
      songControllerRef.current?.stop();
      return;
    }

    const controller = createHeartbeatSongController(dashboardData.heartRateSeries);
    songControllerRef.current = controller;
    controller.start();

    return () => {
      controller.stop();
    };
  }, [dashboardData.heartRateSeries, songReady, soundEnabled]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-heart" aria-hidden="true">
            ♥
          </span>
          <div>
            <p className="eyebrow">{copy.brandTagline}</p>
            <h1>{copy.brandName}</h1>
          </div>
        </div>
        <button
          className="lang-toggle"
          onClick={() => setLanguage(language === "en" ? "vi" : "en")}
          type="button"
          aria-label={copy.languageSwitch}
        >
          {language === "en" ? "VI" : "EN"}
        </button>
      </header>

      <main className="dashboard">
        <section className="hero-card">
          <div className="hero-copy">
            <p className="hero-kicker">{copy.heroKicker}</p>
            <h2>{copy.heroTitle}</h2>
            <p className="hero-description">{copy.heroDescription}</p>
            <div className="hero-actions">
              <button className="ghost-button" type="button" onClick={() => void loadDashboard()}>
                {copy.refresh}
              </button>
              <span className="date-pill">
                {copy.todayLabel}: {dashboard?.date ?? "--"}
              </span>
            </div>
          </div>

          <div className="goal-editor">
            <label htmlFor="goal-input">{copy.goalInputLabel}</label>
            <div className="goal-input-row">
              <input
                id="goal-input"
                min={1}
                step={0.5}
                type="number"
                value={goalKm}
                onChange={(event) => setGoalKm(Number(event.target.value) || 1)}
              />
              <span>{copy.kmUnit}</span>
            </div>
            <button className="ghost-button" type="button" onClick={() => void handleSaveGoal()} disabled={isSavingGoal}>
              {isSavingGoal ? copy.goalSaving : copy.saveGoal}
            </button>
            {goalKm === savedGoalKm ? <span className="goal-status">{copy.goalSaved}</span> : null}
          </div>

          <div className="heart-panel">
            <HeartMeter completion={dashboardData.completion} />
            <div className="heart-stats">
              <div>
                <span>{copy.totalGoalLabel}</span>
                <strong>
                  {goalKm} {copy.kmUnit}
                </strong>
              </div>
              <div>
                <span>{copy.totalRunLabel}</span>
                <strong>
                  {dashboardData.totalKm.toFixed(1)} {copy.kmUnit}
                </strong>
              </div>
              <div>
                <span>{copy.toCompleteLabel}</span>
                <strong>
                  {Math.max(goalKm - dashboardData.totalKm, 0).toFixed(1)} {copy.kmUnit}
                </strong>
              </div>
            </div>
          </div>
        </section>

        {isLoading ? <section className="info-banner">{copy.loading}</section> : null}
        {loadError ? <section className="info-banner info-banner-error">{copy.liveError} {loadError}</section> : null}

        <section className="stats-grid">
          <RunnerCard
            athleteKey="you"
            dashboard={dashboard}
            name={copy.youLabel}
            copy={copy}
            onDisconnect={handleDisconnect}
          />
          <RunnerCard
            athleteKey="partner"
            dashboard={dashboard}
            name={copy.partnerLabel}
            copy={copy}
            onDisconnect={handleDisconnect}
          />
        </section>

        <section className="summary-card">
          <div className="summary-header">
            <div>
              <p className="eyebrow">{copy.summaryKicker}</p>
              <h3>{copy.summaryTitle}</h3>
            </div>
            <div className="progress-pill">
              {Math.round(dashboardData.completion * 100)}%
            </div>
          </div>
          <div className="summary-grid">
            <MetricBox label={copy.combinedHeartRateLabel} value={`${dashboardData.heartRateAvg || 0} bpm`} />
            <MetricBox label={copy.combinedStepsLabel} value={dashboardData.steps.toLocaleString(language)} />
            <MetricBox
              label={copy.combinedCaloriesLabel}
              value={dashboardData.calories.toLocaleString(language)}
            />
          </div>
          <p className="summary-note">{copy.summaryNote}</p>
          <p className="summary-note">{copy.stepEstimateNote}</p>
        </section>

        <section className="auth-card" id="dashboard">
          <div className="summary-header">
            <div>
              <p className="eyebrow">{copy.authKicker}</p>
              <h3>{copy.authTitle}</h3>
            </div>
          </div>

          {authState !== "idle" ? (
            <div className={`auth-status auth-status-${authState}`}>
              {authState === "connected" ? copy.authConnected : copy.authError}
            </div>
          ) : null}

          <div className="auth-actions-grid">
            <a className="connect-button" href={buildStravaAuthorizeUrl("you")}>
              {copy.connectYou}
            </a>
            <a className="connect-button" href={buildStravaAuthorizeUrl("partner")}>
              {copy.connectPartner}
            </a>
          </div>

          <ol className="instruction-list">
            {copy.authSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>

          <div className="scope-list">
            {stravaScopes.map((scope) => (
              <span key={scope}>{scope}</span>
            ))}
          </div>
        </section>

        <section className={`song-card ${songReady ? "song-card-ready" : ""}`}>
          <div>
            <p className="eyebrow">{copy.songKicker}</p>
            <h3>{copy.songTitle}</h3>
            <p>{songReady ? copy.songReadyDescription : copy.songLockedDescription}</p>
          </div>

          <button
            className="song-button"
            type="button"
            disabled={!songReady}
            onClick={() => setSoundEnabled((current) => !current)}
          >
            {!songReady ? copy.songButtonLocked : soundEnabled ? copy.songButtonPause : copy.songButtonPlay}
          </button>
        </section>
      </main>
    </div>
  );

  async function loadDashboard() {
    setIsLoading(true);
    setLoadError(null);

    try {
      const nextDashboard = await fetchDashboard();
      setDashboard(nextDashboard);
      setGoalKm(nextDashboard.goalKm);
      setSavedGoalKm(nextDashboard.goalKm);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleStravaCallback() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const athleteKey = normalizeAthleteKey(params.get("state"));
    const error = params.get("error");
    const scope = params.get("scope") ?? "";

    if (error) {
      setAuthState("error");
      return;
    }

    if (!code || !athleteKey) {
      return;
    }

    try {
      await exchangeStravaCode({ athleteKey, code, scope });
      setAuthState("connected");
      await loadDashboard();
    } catch {
      setAuthState("error");
    } finally {
      window.history.replaceState({}, "", `${window.location.origin}/dashboard`);
    }
  }

  async function handleDisconnect(athleteKey: AthleteKey) {
    await disconnectAthlete(athleteKey);
    await loadDashboard();
  }

  async function handleSaveGoal() {
    setIsSavingGoal(true);

    try {
      const saved = await saveSharedGoal(goalKm);
      setGoalKm(saved.goalKm);
      setSavedGoalKm(saved.goalKm);
      setDashboard((current) => (current ? { ...current, goalKm: saved.goalKm } : current));
    } finally {
      setIsSavingGoal(false);
    }
  }
}

function RunnerCard({
  athleteKey,
  dashboard,
  name,
  copy,
  onDisconnect,
}: {
  athleteKey: AthleteKey;
  dashboard: DashboardResponse | null;
  name: string;
  copy: Copy;
  onDisconnect: (athleteKey: AthleteKey) => Promise<void>;
}) {
  const athleteSnapshot = dashboard?.athletes[athleteKey];
  const metrics = athleteSnapshot?.summary ?? emptyRunnerMetrics();
  const fullName = athleteSnapshot?.athlete
    ? `${athleteSnapshot.athlete.firstname} ${athleteSnapshot.athlete.lastname}`.trim()
    : name;

  return (
    <article className="runner-card">
      <div className="runner-header">
        <div>
          <h3>{fullName || name}</h3>
          <p className="runner-status">
            {athleteSnapshot?.connected ? copy.connectedStatus : copy.disconnectedStatus}
          </p>
        </div>
        <span className="runner-badge">
          {metrics.distanceKm.toFixed(1)} {copy.kmUnit}
        </span>
      </div>
      <div className="runner-metrics">
        <MetricBox label={copy.heartRateLabel} value={`${metrics.heartRateAvg || 0} bpm`} />
        <MetricBox label={copy.stepsLabel} value={metrics.steps.toLocaleString()} />
        <MetricBox label={copy.caloriesLabel} value={metrics.calories.toLocaleString()} />
        <MetricBox label={copy.runCountLabel} value={metrics.activitiesCount.toLocaleString()} />
      </div>
      {athleteSnapshot?.connected ? (
        <button className="disconnect-button" type="button" onClick={() => void onDisconnect(athleteKey)}>
          {copy.disconnect}
        </button>
      ) : null}
      {athleteSnapshot?.error ? <p className="runner-error">{athleteSnapshot.error}</p> : null}
    </article>
  );
}

function MetricBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric-box">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function HeartMeter({ completion }: { completion: number }) {
  const dashOffset = 320 - 320 * completion;
  return (
    <div className="heart-meter" aria-label={`Heart goal ${Math.round(completion * 100)} percent complete`}>
      <svg viewBox="0 0 200 180" role="img">
        <path
          className="heart-track"
          d="M100 165C90 154 15 99 15 55C15 25 39 10 62 10C79 10 92 19 100 31C108 19 121 10 138 10C161 10 185 25 185 55C185 99 110 154 100 165Z"
        />
        <path
          className="heart-progress"
          style={{ strokeDashoffset: dashOffset }}
          d="M100 165C90 154 15 99 15 55C15 25 39 10 62 10C79 10 92 19 100 31C108 19 121 10 138 10C161 10 185 25 185 55C185 99 110 154 100 165Z"
        />
      </svg>
      <div className="heart-center">
        <strong>{Math.round(completion * 100)}%</strong>
      </div>
    </div>
  );
}

function getInitialLanguage(): Language {
  if (typeof navigator === "undefined") {
    return "en";
  }

  return navigator.language.toLowerCase().startsWith("vi") ? "vi" : "en";
}

function buildStravaAuthorizeUrl(athleteKey: AthleteKey) {
  const clientId = import.meta.env.VITE_STRAVA_CLIENT_ID ?? "YOUR_CLIENT_ID";
  const redirectUri =
    import.meta.env.VITE_STRAVA_REDIRECT_URI ?? `${window.location.origin}/dashboard`;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    approval_prompt: "force",
    scope: stravaScopes.join(","),
    state: athleteKey,
  });

  return `https://www.strava.com/oauth/authorize?${params.toString()}`;
}

function normalizeAthleteKey(value: string | null): AthleteKey | null {
  return value === "you" || value === "partner" ? value : null;
}

function emptyRunnerMetrics(): DashboardMetrics {
  return {
    distanceKm: 0,
    heartRateAvg: 0,
    steps: 0,
    calories: 0,
    activitiesCount: 0,
  };
}

export default App;
