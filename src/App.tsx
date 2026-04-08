import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createHeartbeatSongController, type HeartbeatSongController } from "./audio";
import {
  createPairingCode as createPairingCodeRequest,
  disconnectAthlete,
  exchangeStravaCode,
  fetchDashboard,
  fetchSession,
  joinPairingCode as joinPairingCodeRequest,
  login as loginRequest,
  logout as logoutRequest,
  register as registerRequest,
  saveNicknames as saveNicknamesRequest,
  saveStravaAppCredentials as saveStravaAppCredentialsRequest,
  saveSharedGoal,
  type AuthUser,
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

type DemoRunnerState = {
  connected: boolean;
  distanceKm: number;
  heartRateAvg: number;
  steps: number;
  calories: number;
  activitiesCount: number;
};

type NicknameState = {
  you: string;
  partner: string;
};

type StravaAppFormState = {
  athleteKey: AthleteKey;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

type AuthMode = "login" | "register";

type Route = "dashboard" | "demo";
type HeartSegments = {
  you: number;
  partner: number;
};

const defaultDemoState: Record<AthleteKey, DemoRunnerState> = {
  you: {
    connected: true,
    distanceKm: 5.2,
    heartRateAvg: 148,
    steps: 7340,
    calories: 398,
    activitiesCount: 1,
  },
  partner: {
    connected: true,
    distanceKm: 4.8,
    heartRateAvg: 156,
    steps: 7025,
    calories: 372,
    activitiesCount: 1,
  },
};

function App() {
  const initialLanguage = getInitialLanguage();
  const [language, setLanguage] = useState<Language>(initialLanguage);
  const [route, setRoute] = useState<Route>(getRouteFromLocation());
  const copy = languageCopy[language];
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authDisplayName, setAuthDisplayName] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [goalKm, setGoalKm] = useState(defaultGoalKm);
  const [savedGoalKm, setSavedGoalKm] = useState(defaultGoalKm);
  const [isSavingGoal, setIsSavingGoal] = useState(false);
  const [isGoalModalOpen, setIsGoalModalOpen] = useState(false);
  const [nicknames, setNicknames] = useState<NicknameState>(getInitialNicknames(initialLanguage));
  const [savedNicknames, setSavedNicknames] = useState<NicknameState>(getInitialNicknames(initialLanguage));
  const [isSavingNames, setIsSavingNames] = useState(false);
  const [isNamesModalOpen, setIsNamesModalOpen] = useState(false);
  const [isStravaAppModalOpen, setIsStravaAppModalOpen] = useState(false);
  const [isSavingStravaApp, setIsSavingStravaApp] = useState(false);
  const [stravaAppForm, setStravaAppForm] = useState<StravaAppFormState>({
    athleteKey: "you",
    clientId: "",
    clientSecret: "",
    redirectUri: `${window.location.origin}/dashboard`,
  });
  const [pairingCodeInput, setPairingCodeInput] = useState("");
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [demoSoundEnabled, setDemoSoundEnabled] = useState(false);
  const [demoPlaybackProgress, setDemoPlaybackProgress] = useState(0);
  const [authState, setAuthState] = useState<"idle" | "connected" | "error">("idle");
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [demoRunners, setDemoRunners] = useState<Record<AthleteKey, DemoRunnerState>>(defaultDemoState);
  const songControllerRef = useRef<HeartbeatSongController | null>(null);
  const demoSongControllerRef = useRef<HeartbeatSongController | null>(null);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  useEffect(() => {
    if (!dashboard) {
      setNicknames({ you: copy.youLabel, partner: copy.partnerLabel });
      setSavedNicknames({ you: copy.youLabel, partner: copy.partnerLabel });
    }
  }, [copy.partnerLabel, copy.youLabel, dashboard]);

  useEffect(() => {
    void loadSession();
  }, []);

  useEffect(() => {
    return () => {
      songControllerRef.current?.stop();
      demoSongControllerRef.current?.stop();
    };
  }, []);

  useEffect(() => {
    void handleStravaCallback();
  }, [authUser]);

  useEffect(() => {
    const handlePopState = () => setRoute(getRouteFromLocation());
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    if (!isNamesModalOpen) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsNamesModalOpen(false);
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isNamesModalOpen]);

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

  const demoData = useMemo(() => {
    const totalKm = demoRunners.you.distanceKm + demoRunners.partner.distanceKm;
    const steps = demoRunners.you.steps + demoRunners.partner.steps;
    const calories = demoRunners.you.calories + demoRunners.partner.calories;
    const weightedHeartRate = weightedAverage([
      { value: demoRunners.you.heartRateAvg, weight: Math.max(demoRunners.you.distanceKm, 0.1) },
      { value: demoRunners.partner.heartRateAvg, weight: Math.max(demoRunners.partner.distanceKm, 0.1) },
    ]);

    return {
      totalKm,
      completion: Math.min(totalKm / goalKm, 1),
      steps,
      calories,
      heartRateAvg: Math.round(weightedHeartRate),
      heartRateSeries: buildDemoHeartRateSeries(demoRunners),
      allConnected: demoRunners.you.connected && demoRunners.partner.connected,
    };
  }, [demoRunners, goalKm]);

  const songReady = dashboardData.completion >= 1 && dashboardData.heartRateSeries.length > 0;
  const demoSongReady = demoData.allConnected && demoData.heartRateSeries.length > 0;
  const dashboardSegments = useMemo(
    () => buildHeartSegments(dashboard, goalKm),
    [dashboard, goalKm],
  );
  const demoSegments = useMemo(
    () => buildDemoHeartSegments(demoRunners, goalKm),
    [demoRunners, goalKm],
  );

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

  useEffect(() => {
    if (!demoSongReady || !demoSoundEnabled) {
      demoSongControllerRef.current?.stop();
      return;
    }

    const controller = createHeartbeatSongController(demoData.heartRateSeries, {
      onProgressChange: setDemoPlaybackProgress,
      cycleDurationMs: 7200,
    });
    demoSongControllerRef.current = controller;
    controller.start(demoPlaybackProgress);

    return () => {
      controller.stop();
    };
  }, [demoData.heartRateSeries, demoSongReady, demoSoundEnabled]);

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
        <div className="topbar-actions">
          {authUser ? (
            <button className="ghost-button" type="button" onClick={() => void handleLogout()}>
              Logout
            </button>
          ) : null}
          <nav className="route-switcher" aria-label="Views">
            <button
              className={`route-link ${route === "dashboard" ? "route-link-active" : ""}`}
              type="button"
              onClick={() => navigateTo("dashboard", setRoute)}
            >
              {copy.dashboardNav}
            </button>
            <button
              className={`route-link ${route === "demo" ? "route-link-active" : ""}`}
              type="button"
              onClick={() => navigateTo("demo", setRoute)}
            >
              {copy.demoNav}
            </button>
          </nav>
          <button
            className="lang-toggle"
            onClick={() => setLanguage(language === "en" ? "vi" : "en")}
            type="button"
            aria-label={copy.languageSwitch}
          >
            {language === "en" ? "VI" : "EN"}
          </button>
        </div>
      </header>

      {route === "dashboard"
        ? authUser
          ? renderDashboard()
          : renderAuth()
        : renderDemo()}

      {isGoalModalOpen ? (
        <GoalModal
          copy={copy}
          goalKm={goalKm}
          savedGoalKm={savedGoalKm}
          isSavingGoal={isSavingGoal}
          onGoalChange={setGoalKm}
          onSave={() => void handleSaveGoal()}
          onClose={() => setIsGoalModalOpen(false)}
        />
      ) : null}

      {isNamesModalOpen ? (
        <NicknameModal
          copy={copy}
          nicknames={nicknames}
          savedNicknames={savedNicknames}
          isSavingNames={isSavingNames}
          onChange={(value) => setNicknames(value)}
          onSave={() => void handleSaveNicknames()}
          onClose={() => setIsNamesModalOpen(false)}
        />
      ) : null}

      {isStravaAppModalOpen ? (
        <StravaAppModal
          copy={copy}
          form={stravaAppForm}
          isSaving={isSavingStravaApp}
          onChange={setStravaAppForm}
          onSave={() => void handleSaveStravaAppCredentials()}
          onClose={() => setIsStravaAppModalOpen(false)}
        />
      ) : null}
    </div>
  );

  function renderDashboard() {
    return (
      <main className="dashboard">
        <section className="hero-card">
          <div className="hero-copy hero-copy-main">
            <p className="hero-kicker">{copy.heroKicker}</p>
            <h2 className="demo-love-title">love run</h2>
            <InfoToggle summary={copy.moreDetails}>
              <p className="hero-description">{copy.heroDescription}</p>
            </InfoToggle>
          </div>

          <button className="ghost-button hero-set-names-button" type="button" onClick={() => setIsNamesModalOpen(true)}>
            {copy.editNames}
          </button>

          <div className="hero-toolbar">
            <span className="date-pill">
              {copy.todayLabel}: {dashboard?.date ?? "--"}
            </span>
            <button className="ghost-button icon-button" type="button" onClick={() => void loadDashboard()} aria-label={copy.refresh}>
              ↻
            </button>
          </div>

          <div className="hero-goal-panel">
            <GoalCard
              copy={copy}
              goalKm={goalKm}
              onClick={() => setIsGoalModalOpen(true)}
            />
          </div>

          <div className="hero-heart-panel">
            <HeartMeter
              completion={dashboardData.completion}
              totalKm={dashboardData.totalKm}
              goalKm={goalKm}
              unitLabel={copy.kmUnit}
            />
          </div>

          <div className="hero-stats-panel">
            <StatsPanel
              copy={copy}
              goalKm={goalKm}
              totalKm={dashboardData.totalKm}
            />
          </div>

          <SplitProgressBar
            className="split-progress-embedded"
            copy={copy}
            leftLabel={nicknames.you}
            rightLabel={nicknames.partner}
            leftProgress={dashboardSegments.you}
            rightProgress={dashboardSegments.partner}
          />
        </section>

        {isLoading ? <section className="info-banner">{copy.loading}</section> : null}
        {loadError ? <section className="info-banner info-banner-error">{copy.liveError} {loadError}</section> : null}

        <section className="stats-grid">
          <RunnerCard
            athleteKey="you"
            dashboard={dashboard}
            name={nicknames.you}
            copy={copy}
            onDisconnect={handleDisconnect}
          />
          <RunnerCard
            athleteKey="partner"
            dashboard={dashboard}
            name={nicknames.partner}
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
          <InfoToggle summary={copy.moreDetails}>
            <p className="summary-note">{copy.summaryNote}</p>
            <p className="summary-note">{copy.stepEstimateNote}</p>
          </InfoToggle>
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
            <AuthRunnerAction
              athleteKey="you"
              copy={copy}
              title={nicknames.you}
              connectLabel={copy.connectYou}
              config={dashboard?.stravaApps.you}
              onConfigure={() => openStravaAppModal("you")}
            />
            <MetricBox
              label={copy.partnerLabel}
              value={dashboard?.pairing.paired ? nicknames.partner : copy.pairingWaiting}
            />
          </div>

          <InfoToggle summary={copy.moreDetails}>
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
          </InfoToggle>
        </section>

        <section className="summary-card">
          <div className="summary-header">
            <div>
              <p className="eyebrow">{copy.pairingKicker}</p>
              <h3>{copy.pairingTitle}</h3>
            </div>
          </div>
          <div className="pairing-grid">
            <button className="ghost-button" type="button" onClick={() => void handleCreatePairingCode()}>
              {copy.generateCode}
            </button>
            <div className="pairing-input-row">
              <input
                type="text"
                value={pairingCodeInput}
                placeholder={copy.pairingInputPlaceholder}
                onChange={(event) => setPairingCodeInput(event.target.value.toUpperCase())}
              />
              <button className="ghost-button" type="button" onClick={() => void handleJoinPairingCode()}>
                {copy.joinCode}
              </button>
            </div>
          </div>
          <div className="summary-grid">
            <MetricBox label={copy.pairingCodeLabel} value={dashboard?.pairing.code ?? "--"} />
            <MetricBox
              label={copy.connectedStatus}
              value={dashboard?.pairing.paired ? copy.pairingConnected : copy.pairingWaiting}
            />
          </div>
        </section>

        <section className={`song-card ${songReady ? "song-card-ready" : ""}`}>
          <div>
            <p className="eyebrow">{copy.songKicker}</p>
            <h3>{copy.songTitle}</h3>
            <InfoToggle summary={copy.moreDetails}>
              <p className="summary-note">{songReady ? copy.songReadyDescription : copy.songLockedDescription}</p>
            </InfoToggle>
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
    );
  }

  function renderAuth() {
    return (
      <main className="dashboard">
        <section className="summary-card auth-gate-card">
          <div className="hero-copy">
            <p className="hero-kicker">{copy.brandTagline}</p>
            <h2 className="demo-love-title">love run</h2>
            <p className="hero-description">
              Sign in to connect your Strava account, create a pairing code, and unlock a shared couple dashboard.
            </p>
          </div>
          <div className="route-switcher auth-mode-switcher">
            <button
              className={`route-link ${authMode === "login" ? "route-link-active" : ""}`}
              type="button"
              onClick={() => setAuthMode("login")}
            >
              Login
            </button>
            <button
              className={`route-link ${authMode === "register" ? "route-link-active" : ""}`}
              type="button"
              onClick={() => setAuthMode("register")}
            >
              Register
            </button>
          </div>
          <div className="auth-form-grid">
            {authMode === "register" ? (
              <label className="nickname-field">
                <span>Display name</span>
                <input value={authDisplayName} onChange={(event) => setAuthDisplayName(event.target.value)} />
              </label>
            ) : null}
            <label className="nickname-field">
              <span>Email</span>
              <input type="email" value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} />
            </label>
            <label className="nickname-field">
              <span>Password</span>
              <input type="password" value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} />
            </label>
          </div>
          {authError ? <p className="runner-error">{authError}</p> : null}
          <button className="song-button" type="button" onClick={() => void handleAuthSubmit()} disabled={isAuthLoading}>
            {isAuthLoading ? "Please wait..." : authMode === "login" ? "Login" : "Create account"}
          </button>
        </section>
      </main>
    );
  }

  function renderDemo() {
    const demoSummary = describeGeneratedSong(demoData.heartRateAvg, demoData.totalKm);

    return (
      <main className="dashboard">
        <section className="hero-card">
          <div className="hero-copy hero-copy-main">
            <p className="hero-kicker">{copy.demoKicker}</p>
            <h2 className="demo-love-title">love run</h2>
            <InfoToggle summary={copy.moreDetails}>
              <p className="hero-description">{copy.demoDescription}</p>
              <p className="summary-note">{copy.demoSetupNote}</p>
            </InfoToggle>
          </div>

          <button className="ghost-button hero-set-names-button" type="button" onClick={() => setIsNamesModalOpen(true)}>
            {copy.editNames}
          </button>

          <div className="hero-toolbar">
            <span className="date-pill">
              {copy.todayLabel}: {dashboard?.date ?? "--"}
            </span>
            <button className="ghost-button icon-button" type="button" onClick={() => void loadDashboard()} aria-label={copy.refresh}>
              ↻
            </button>
          </div>

          <div className="hero-goal-panel">
            <GoalCard
              copy={copy}
              goalKm={goalKm}
              onClick={() => setIsGoalModalOpen(true)}
            />
          </div>

          <div className="hero-heart-panel">
            <HeartMeter
              completion={demoData.completion}
              totalKm={demoData.totalKm}
              goalKm={goalKm}
              unitLabel={copy.kmUnit}
            />
          </div>

          <div className="hero-stats-panel">
            <StatsPanel
              copy={copy}
              goalKm={goalKm}
              totalKm={demoData.totalKm}
            />
          </div>

          <SplitProgressBar
            className="split-progress-embedded"
            copy={copy}
            leftLabel={nicknames.you}
            rightLabel={nicknames.partner}
            leftProgress={demoSegments.you}
            rightProgress={demoSegments.partner}
          />
        </section>

        <section className="stats-grid">
          <DemoRunnerCard
            athleteKey="you"
            label={nicknames.you}
            copy={copy}
            runner={demoRunners.you}
            onChange={updateDemoRunner}
          />
          <DemoRunnerCard
            athleteKey="partner"
            label={nicknames.partner}
            copy={copy}
            runner={demoRunners.partner}
            onChange={updateDemoRunner}
          />
        </section>

        <section className="auth-card">
          <div className="summary-header">
            <div>
              <p className="eyebrow">{copy.authKicker}</p>
              <h3>{copy.authTitle}</h3>
            </div>
          </div>
          <div className="auth-actions-grid">
            <AuthRunnerAction
              athleteKey="you"
              copy={copy}
              title={nicknames.you}
              connectLabel={copy.connectYou}
              config={dashboard?.stravaApps.you}
              onConfigure={() => openStravaAppModal("you")}
            />
            <MetricBox
              label={copy.partnerLabel}
              value={dashboard?.pairing.paired ? nicknames.partner : copy.pairingWaiting}
            />
          </div>
          <InfoToggle summary={copy.moreDetails}>
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
          </InfoToggle>
        </section>

        <section className="summary-card">
          <div className="summary-header">
            <div>
              <p className="eyebrow">{copy.pairingKicker}</p>
              <h3>{copy.pairingTitle}</h3>
            </div>
          </div>
          <div className="pairing-grid">
            <button className="ghost-button" type="button" onClick={() => void handleCreatePairingCode()}>
              {copy.generateCode}
            </button>
            <div className="pairing-input-row">
              <input
                type="text"
                value={pairingCodeInput}
                placeholder={copy.pairingInputPlaceholder}
                onChange={(event) => setPairingCodeInput(event.target.value.toUpperCase())}
              />
              <button className="ghost-button" type="button" onClick={() => void handleJoinPairingCode()}>
                {copy.joinCode}
              </button>
            </div>
          </div>
          <div className="summary-grid">
            <MetricBox label={copy.pairingCodeLabel} value={dashboard?.pairing.code ?? "--"} />
            <MetricBox
              label={copy.connectedStatus}
              value={dashboard?.pairing.paired ? copy.pairingConnected : copy.pairingWaiting}
            />
          </div>
        </section>

        <section className="summary-card">
          <div className="summary-header">
            <div>
              <p className="eyebrow">{copy.demoAudioKicker}</p>
              <h3>{copy.demoAudioTitle}</h3>
            </div>
            <div className="progress-pill">
              {Math.round(demoData.completion * 100)}%
            </div>
          </div>
          <div className="summary-grid">
            <MetricBox label={copy.combinedHeartRateLabel} value={`${demoData.heartRateAvg} bpm`} />
            <MetricBox label={copy.demoTempoLabel} value={`${demoSummary.tempoBpm} bpm`} />
            <MetricBox label={copy.demoMoodLabel} value={demoSummary.mood} />
          </div>
          <EcgPreview
            heartRates={demoData.heartRateSeries}
            progress={demoPlaybackProgress}
            isPlaying={demoSoundEnabled}
            onSeek={(progress) => {
              setDemoPlaybackProgress(progress);
              if (demoSoundEnabled) {
                demoSongControllerRef.current?.stop();
                const controller = createHeartbeatSongController(demoData.heartRateSeries, {
                  onProgressChange: setDemoPlaybackProgress,
                  cycleDurationMs: 7200,
                });
                demoSongControllerRef.current = controller;
                controller.start(progress);
              }
            }}
            onTogglePlay={() => setDemoSoundEnabled((current) => !current)}
            copy={copy}
          />
          <InfoToggle summary={copy.moreDetails}>
            <p className="summary-note">{copy.demoAudioDescription}</p>
            <p className="summary-note">
              {copy.demoAudioFormula}: {demoSummary.formula}
            </p>
            {!demoSongReady ? <p className="summary-note">{copy.demoAudioLocked}</p> : null}
          </InfoToggle>
        </section>
      </main>
    );
  }

  async function loadDashboard() {
    if (!authUser) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setLoadError(null);

    try {
      const nextDashboard = await fetchDashboard();
      setDashboard(nextDashboard);
      setGoalKm(nextDashboard.goalKm);
      setSavedGoalKm(nextDashboard.goalKm);
      setNicknames(nextDashboard.nicknames);
      setSavedNicknames(nextDashboard.nicknames);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  }

  async function loadSession() {
    setIsLoading(true);

    try {
      const session = await fetchSession();
      setAuthUser(session.user);
      if (session.user) {
        await loadDashboardForUser(session.user);
      }
    } catch {
      setAuthUser(null);
    } finally {
      setIsLoading(false);
    }
  }

  async function loadDashboardForUser(user: AuthUser) {
    const nextDashboard = await fetchDashboard();
    setAuthUser(user);
    setDashboard(nextDashboard);
    setGoalKm(nextDashboard.goalKm);
    setSavedGoalKm(nextDashboard.goalKm);
    setNicknames(nextDashboard.nicknames);
    setSavedNicknames(nextDashboard.nicknames);
  }

  async function handleStravaCallback() {
    if (!authUser) {
      return;
    }

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

  async function handleAuthSubmit() {
    setIsAuthLoading(true);
    setAuthError(null);

    try {
      const auth =
        authMode === "login"
          ? await loginRequest({ email: authEmail, password: authPassword })
          : await registerRequest({
              email: authEmail,
              password: authPassword,
              displayName: authDisplayName,
            });

      setAuthUser(auth.user);
      try {
        await loadDashboardForUser(auth.user);
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : "Could not load dashboard.");
      }
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Authentication failed.");
    } finally {
      setIsAuthLoading(false);
    }
  }

  async function handleLogout() {
    await logoutRequest();
    setAuthUser(null);
    setDashboard(null);
    setAuthState("idle");
  }

  async function handleSaveGoal() {
    setIsSavingGoal(true);

    try {
      const saved = await saveSharedGoal(goalKm);
      setGoalKm(saved.goalKm);
      setSavedGoalKm(saved.goalKm);
      setDashboard((current) => (current ? { ...current, goalKm: saved.goalKm } : current));
      setIsGoalModalOpen(false);
    } finally {
      setIsSavingGoal(false);
    }
  }

  async function handleSaveNicknames() {
    setIsSavingNames(true);

    try {
      const saved = await saveNicknamesRequest(nicknames);
      setNicknames(saved);
      setSavedNicknames(saved);
      setDashboard((current) => (current ? { ...current, nicknames: saved } : current));
      setIsNamesModalOpen(false);
    } finally {
      setIsSavingNames(false);
    }
  }

  async function handleSaveStravaAppCredentials() {
    setIsSavingStravaApp(true);

    try {
      const saved = await saveStravaAppCredentialsRequest(stravaAppForm);
      setDashboard((current) =>
        current
          ? {
              ...current,
              stravaApps: {
                ...current.stravaApps,
                [stravaAppForm.athleteKey]: saved,
              },
            }
          : current,
      );
      setStravaAppForm((current) => ({ ...current, clientSecret: "" }));
      setIsStravaAppModalOpen(false);
    } finally {
      setIsSavingStravaApp(false);
    }
  }

  function openStravaAppModal(athleteKey: AthleteKey) {
    const current = dashboard?.stravaApps[athleteKey];
    setStravaAppForm({
      athleteKey,
      clientId: current?.clientId ?? "",
      clientSecret: "",
      redirectUri: current?.redirectUri ?? `${window.location.origin}/dashboard`,
    });
    setIsStravaAppModalOpen(true);
  }

  async function handleCreatePairingCode() {
    const pairing = await createPairingCodeRequest();
    setDashboard((current) => (current ? { ...current, pairing } : current));
  }

  async function handleJoinPairingCode() {
    const pairing = await joinPairingCodeRequest(pairingCodeInput);
    setDashboard((current) => (current ? { ...current, pairing } : current));
  }

  function updateDemoRunner(athleteKey: AthleteKey, key: keyof DemoRunnerState, value: number | boolean) {
    setDemoRunners((current) => ({
      ...current,
      [athleteKey]: {
        ...current[athleteKey],
        [key]: value,
      },
    }));
  }
}

function GoalCard({
  copy,
  goalKm,
  onClick,
}: {
  copy: Copy;
  goalKm: number;
  onClick: () => void;
}) {
  const safeGoalKm = toSafeNumber(goalKm);

  return (
    <button className="goal-card-button" type="button" onClick={onClick}>
      <span>{copy.goalInputLabel}</span>
      <strong>{safeGoalKm}{copy.kmUnit}</strong>
      <em>{copy.editGoalHint}</em>
    </button>
  );
}

function GoalModal({
  copy,
  goalKm,
  savedGoalKm,
  isSavingGoal,
  onGoalChange,
  onSave,
  onClose,
}: {
  copy: Copy;
  goalKm: number;
  savedGoalKm: number;
  isSavingGoal: boolean;
  onGoalChange: (goalKm: number) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section
        className="goal-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="goal-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="nickname-modal-header">
          <div>
            <p className="eyebrow">{copy.goalInputLabel}</p>
            <h3 id="goal-modal-title">{copy.editGoal}</h3>
          </div>
          <button className="ghost-button nickname-close-button" type="button" onClick={onClose}>
            {copy.closeModal}
          </button>
        </div>
        <label htmlFor="goal-input" className="nickname-field">
          <span>{copy.goalInputLabel}</span>
          <div className="goal-input-row goal-input-row-large">
            <input
              id="goal-input"
              min={1}
              step={0.5}
              type="number"
              value={goalKm}
              onChange={(event) => onGoalChange(Number(event.target.value) || 1)}
            />
            <span>{copy.kmUnit}</span>
          </div>
        </label>
        <div className="nickname-modal-actions">
          <button className="ghost-button" type="button" onClick={onSave} disabled={isSavingGoal}>
            {isSavingGoal ? copy.goalSaving : copy.saveGoal}
          </button>
          {goalKm === savedGoalKm ? <span className="goal-status">{copy.goalSaved}</span> : null}
        </div>
      </section>
    </div>
  );
}

function NicknameModal({
  copy,
  nicknames,
  savedNicknames,
  isSavingNames,
  onChange,
  onSave,
  onClose,
}: {
  copy: Copy;
  nicknames: NicknameState;
  savedNicknames: NicknameState;
  isSavingNames: boolean;
  onChange: (value: NicknameState) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const isSaved = nicknames.you === savedNicknames.you && nicknames.partner === savedNicknames.partner;

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section
        className="nickname-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="nickname-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="nickname-modal-header">
          <div>
            <p className="eyebrow">{copy.nicknameKicker}</p>
            <h3 id="nickname-modal-title">{copy.nicknameTitle}</h3>
          </div>
          <button className="ghost-button nickname-close-button" type="button" onClick={onClose}>
            {copy.closeModal}
          </button>
        </div>
        <label className="nickname-field">
          <span>{copy.yourNicknameLabel}</span>
          <input
            type="text"
            maxLength={24}
            value={nicknames.you}
            onChange={(event) => onChange({ ...nicknames, you: event.target.value })}
          />
        </label>
        <label className="nickname-field">
          <span>{copy.partnerNicknameLabel}</span>
          <input
            type="text"
            maxLength={24}
            value={nicknames.partner}
            onChange={(event) => onChange({ ...nicknames, partner: event.target.value })}
          />
        </label>
        <div className="nickname-modal-actions">
          <button className="ghost-button" type="button" onClick={onSave} disabled={isSavingNames}>
            {isSavingNames ? copy.namesSaving : copy.saveNames}
          </button>
          {isSaved ? <span className="goal-status">{copy.namesSaved}</span> : null}
        </div>
      </section>
    </div>
  );
}

function StatsPanel({
  copy,
  goalKm,
  totalKm,
}: {
  copy: Copy;
  goalKm: number;
  totalKm: number;
}) {
  const safeGoalKm = toSafeNumber(goalKm);
  const safeTotalKm = toSafeNumber(totalKm);

  return (
    <div className="heart-stats">
      <div>
        <span>{copy.totalRunLabel}</span>
        <strong>
          {safeTotalKm.toFixed(1)} {copy.kmUnit}
        </strong>
      </div>
      <div>
        <span>{copy.toCompleteLabel}</span>
        <strong>
          {Math.max(safeGoalKm - safeTotalKm, 0).toFixed(1)} {copy.kmUnit}
        </strong>
      </div>
    </div>
  );
}

function DemoRunnerCard({
  athleteKey,
  label,
  copy,
  runner,
  onChange,
}: {
  athleteKey: AthleteKey;
  label: string;
  copy: Copy;
  runner: DemoRunnerState;
  onChange: (athleteKey: AthleteKey, key: keyof DemoRunnerState, value: number | boolean) => void;
}) {
  const safeDistanceKm = toSafeNumber(runner.distanceKm);

  return (
    <article className="runner-card">
      <div className="runner-header">
        <div>
          <h3>{label}</h3>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={runner.connected}
              onChange={(event) => onChange(athleteKey, "connected", event.target.checked)}
            />
            <span>{runner.connected ? copy.connectedStatus : copy.disconnectedStatus}</span>
          </label>
        </div>
        <span className="runner-badge">
          {safeDistanceKm.toFixed(1)} {copy.kmUnit}
        </span>
      </div>

      <div className="demo-grid">
        <DemoField
          label={copy.demoDistanceLabel}
          value={runner.distanceKm}
          step={0.1}
          suffix={copy.kmUnit}
          onChange={(value) => onChange(athleteKey, "distanceKm", value)}
        />
        <DemoField
          label={copy.heartRateLabel}
          value={runner.heartRateAvg}
          step={1}
          suffix="bpm"
          onChange={(value) => onChange(athleteKey, "heartRateAvg", value)}
        />
        <DemoField
          label={copy.stepsLabel}
          value={runner.steps}
          step={100}
          onChange={(value) => onChange(athleteKey, "steps", value)}
        />
        <DemoField
          label={copy.caloriesLabel}
          value={runner.calories}
          step={10}
          onChange={(value) => onChange(athleteKey, "calories", value)}
        />
        <DemoField
          label={copy.runCountLabel}
          value={runner.activitiesCount}
          step={1}
          onChange={(value) => onChange(athleteKey, "activitiesCount", value)}
        />
      </div>
    </article>
  );
}

function DemoField({
  label,
  value,
  onChange,
  step,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  step: number;
  suffix?: string;
}) {
  return (
    <label className="demo-field">
      <span>{label}</span>
      <div className="demo-input-wrap">
        <input
          type="number"
          min={0}
          step={step}
          value={value}
          onChange={(event) => onChange(Math.max(0, Number(event.target.value) || 0))}
        />
        {suffix ? <em>{suffix}</em> : null}
      </div>
    </label>
  );
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
  const safeDistanceKm = toSafeNumber(metrics.distanceKm);
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
          {safeDistanceKm.toFixed(1)} {copy.kmUnit}
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

function AuthRunnerAction({
  athleteKey,
  copy,
  title,
  connectLabel,
  config,
  onConfigure,
}: {
  athleteKey: AthleteKey;
  copy: Copy;
  title: string;
  connectLabel: string;
  config:
    | {
        configured: boolean;
        clientId: string;
        redirectUri: string;
        updatedAt: string | null;
      }
    | undefined;
  onConfigure: () => void;
}) {
  const href = buildStravaAuthorizeUrl(athleteKey, config);

  return (
    <div className="auth-runner-action">
      <strong>{title}</strong>
      <button className="ghost-button" type="button" onClick={onConfigure}>
        {copy.setCredentials}
      </button>
      <a
        className={`connect-button ${!config?.configured ? "connect-button-disabled" : ""}`}
        href={href}
        aria-disabled={!config?.configured}
        onClick={(event) => {
          if (!config?.configured) {
            event.preventDefault();
            onConfigure();
          }
        }}
      >
        {connectLabel}
      </a>
    </div>
  );
}

function StravaAppModal({
  copy,
  form,
  isSaving,
  onChange,
  onSave,
  onClose,
}: {
  copy: Copy;
  form: StravaAppFormState;
  isSaving: boolean;
  onChange: (value: StravaAppFormState) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section
        className="goal-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="strava-app-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="nickname-modal-header">
          <div>
            <p className="eyebrow">{form.athleteKey === "you" ? copy.youLabel : copy.partnerLabel}</p>
            <h3 id="strava-app-modal-title">{copy.stravaCredentialsTitle}</h3>
          </div>
          <button className="ghost-button nickname-close-button" type="button" onClick={onClose}>
            {copy.closeModal}
          </button>
        </div>
        <p className="summary-note">{copy.stravaCredentialsDescription}</p>
        <label className="nickname-field">
          <span>{copy.clientIdLabel}</span>
          <input
            type="text"
            value={form.clientId}
            onChange={(event) => onChange({ ...form, clientId: event.target.value })}
          />
        </label>
        <label className="nickname-field">
          <span>{copy.clientSecretLabel}</span>
          <input
            type="password"
            value={form.clientSecret}
            onChange={(event) => onChange({ ...form, clientSecret: event.target.value })}
          />
        </label>
        <label className="nickname-field">
          <span>{copy.redirectUriLabel}</span>
          <input
            type="url"
            value={form.redirectUri}
            onChange={(event) => onChange({ ...form, redirectUri: event.target.value })}
          />
        </label>
        <div className="nickname-modal-actions">
          <button className="ghost-button" type="button" onClick={onSave} disabled={isSaving}>
            {isSaving ? copy.credentialsSaving : copy.saveCredentials}
          </button>
        </div>
      </section>
    </div>
  );
}

function InfoToggle({
  summary,
  children,
}: {
  summary: string;
  children: ReactNode;
}) {
  return (
    <details className="info-toggle">
      <summary>{summary}</summary>
      <div className="info-toggle-content">{children}</div>
    </details>
  );
}

function HeartMeter({
  completion,
  totalKm,
  goalKm,
  unitLabel,
}: {
  completion: number;
  totalKm: number;
  goalKm: number;
  unitLabel: string;
}) {
  const safeCompletion = toSafeNumber(completion);
  const safeTotalKm = toSafeNumber(totalKm);
  const safeGoalKm = toSafeNumber(goalKm);
  const normalizedCompletion = Math.min(Math.max(safeCompletion, 0), 1);
  const progressLength = Number((normalizedCompletion * 100).toFixed(3));

  return (
    <div
      className="heart-meter"
      aria-label={`Heart goal ${Math.round(normalizedCompletion * 100)} percent complete`}
    >
      <svg viewBox="0 0 200 180" role="img">
        <defs>
          <linearGradient id="heart-gradient-total" x1="8%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#ff9cc0" />
            <stop offset="100%" stopColor="#ea5f95" />
          </linearGradient>
        </defs>
        <path
          className="heart-track"
          pathLength={100}
          d="M100 165C90 154 15 99 15 55C15 25 39 10 62 10C79 10 92 19 100 31C108 19 121 10 138 10C161 10 185 25 185 55C185 99 110 154 100 165Z"
        />
        {progressLength > 0 ? (
          <path
            className="heart-progress heart-progress-total"
            pathLength={100}
            strokeDasharray={`${progressLength} 100`}
            d="M100 165C90 154 15 99 15 55C15 25 39 10 62 10C79 10 92 19 100 31C108 19 121 10 138 10C161 10 185 25 185 55C185 99 110 154 100 165Z"
          />
        ) : null}
      </svg>
      <div className="heart-center">
        <strong>{Math.round(normalizedCompletion * 100)}%</strong>
        <span>
          {safeTotalKm.toFixed(1)} / {safeGoalKm.toFixed(1)} {unitLabel}
        </span>
      </div>
    </div>
  );
}

function SplitProgressBar({
  className,
  copy,
  leftLabel,
  rightLabel,
  leftProgress,
  rightProgress,
}: {
  className?: string;
  copy: Copy;
  leftLabel: string;
  rightLabel: string;
  leftProgress: number;
  rightProgress: number;
}) {
  const leftPercent = Math.round(leftProgress * 100);
  const rightPercent = Math.round(rightProgress * 100);
  const remainingPercent = Math.max(100 - leftPercent - rightPercent, 0);

  return (
    <section className={`split-progress-card ${className ?? ""}`.trim()}>
      <div className="split-progress-copy">
        <div>
          <strong>{leftLabel}</strong>
          <span>{leftPercent}%</span>
        </div>
        <div className="split-progress-center">
          <strong>{copy.needMoreEffortLabel}</strong>
          <span>{remainingPercent}%</span>
        </div>
        <div>
          <strong>{rightLabel}</strong>
          <span>{rightPercent}%</span>
        </div>
      </div>
      <div className="split-progress-track">
        <div className="split-progress-fill split-progress-fill-left" style={{ width: `${leftPercent}%` }} />
        <div className="split-progress-fill split-progress-fill-right" style={{ width: `${rightPercent}%` }} />
      </div>
    </section>
  );
}

function EcgPreview({
  heartRates,
  progress,
  isPlaying,
  onSeek,
  onTogglePlay,
  copy,
}: {
  heartRates: number[];
  progress: number;
  isPlaying: boolean;
  onSeek: (progress: number) => void;
  onTogglePlay: () => void;
  copy: Copy;
}) {
  const ecgPath = useMemo(() => buildEcgPath(heartRates), [heartRates]);
  const progressWidth = `${Math.max(0, Math.min(1, progress)) * 100}%`;

  return (
    <div className="ecg-card" aria-label="ECG preview">
      <div className="ecg-stage">
        <div className="ecg-progress-fill" style={{ width: progressWidth }} />
        <svg viewBox="0 0 640 180" role="img">
          <defs>
            <pattern id="ecg-grid" width="32" height="32" patternUnits="userSpaceOnUse">
              <path d="M 32 0 L 0 0 0 32" fill="none" stroke="rgba(255, 161, 196, 0.15)" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="640" height="180" rx="18" fill="#fff4f8" />
          <rect width="640" height="180" rx="18" fill="url(#ecg-grid)" />
          <path
            d={ecgPath}
            fill="none"
            stroke="#8a95a0"
            strokeWidth="4"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <path
            d={ecgPath}
            fill="none"
            stroke="#ec5f96"
            strokeWidth="4"
            strokeLinejoin="round"
            strokeLinecap="round"
            strokeDasharray={`${Math.max(0, Math.min(1, progress)) * 1000} 1000`}
            pathLength={1000}
            filter="drop-shadow(0 0 10px rgba(236,95,150,0.45))"
          />
        </svg>
        <input
          className="ecg-slider"
          type="range"
          min={0}
          max={1000}
          value={Math.round(progress * 1000)}
          onChange={(event) => onSeek(Number(event.target.value) / 1000)}
          aria-label="Audio playback progress"
        />
      </div>
      <div className="ecg-controls">
        <button className="ecg-icon-button" type="button" onClick={onTogglePlay}>
          <span className="ecg-icon-heart" aria-hidden="true">
            {isPlaying ? "❚❚" : "▶"}
          </span>
          <span>{isPlaying ? copy.songButtonPause : copy.songButtonPlay}</span>
        </button>
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

function getInitialNicknames(language: Language): NicknameState {
  const copy = languageCopy[language];
  return {
    you: copy.youLabel,
    partner: copy.partnerLabel,
  };
}

function getRouteFromLocation(): Route {
  return window.location.pathname === "/demo" ? "demo" : "dashboard";
}

function navigateTo(route: Route, setRoute: (route: Route) => void) {
  const path = route === "demo" ? "/demo" : "/dashboard";
  window.history.pushState({}, "", path);
  setRoute(route);
}

function buildStravaAuthorizeUrl(
  athleteKey: AthleteKey,
  config?: {
    configured: boolean;
    clientId: string;
    redirectUri: string;
    updatedAt: string | null;
  },
) {
  if (!config?.configured || !config.clientId || !config.redirectUri) {
    return "#";
  }

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
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

function buildDemoHeartRateSeries(runners: Record<AthleteKey, DemoRunnerState>) {
  const baseSeries = [runners.you.heartRateAvg, runners.partner.heartRateAvg];

  return baseSeries.flatMap((rate, index) => {
    const sway = index === 0 ? [-6, -2, 3, 7] : [-4, 1, 5, 9];
    return sway.map((offset) => Math.max(60, rate + offset));
  });
}

function describeGeneratedSong(heartRateAvg: number, totalKm: number) {
  const tempoBpm = Math.max(72, Math.round(heartRateAvg * 0.8));
  const mood = heartRateAvg >= 155 ? "Intense ECG pulse" : heartRateAvg >= 140 ? "Steady heartbeat glow" : "Soft resting pulse";
  const distanceBars = Math.max(4, Math.round(totalKm));

  return {
    tempoBpm,
    mood,
    formula: `${heartRateAvg} avg HR -> lub-dub beat at ${tempoBpm} bpm, ${distanceBars} waveform bars, ECG-style pulse from both runners`,
  };
}

function weightedAverage(items: Array<{ value: number; weight: number }>) {
  const validItems = items.filter((item) => item.value > 0 && item.weight > 0);

  if (validItems.length === 0) {
    return 0;
  }

  const weightedSum = validItems.reduce((sum, item) => sum + item.value * item.weight, 0);
  const totalWeight = validItems.reduce((sum, item) => sum + item.weight, 0);
  return weightedSum / totalWeight;
}

function buildHeartSegments(dashboard: DashboardResponse | null, goalKm: number): HeartSegments {
  if (!dashboard || goalKm <= 0) {
    return { you: 0, partner: 0 };
  }

  return buildSegmentsFromDistances(
    dashboard.athletes.you.summary.distanceKm,
    dashboard.athletes.partner.summary.distanceKm,
    goalKm,
  );
}

function buildDemoHeartSegments(runners: Record<AthleteKey, DemoRunnerState>, goalKm: number): HeartSegments {
  if (goalKm <= 0) {
    return { you: 0, partner: 0 };
  }

  return buildSegmentsFromDistances(
    runners.you.distanceKm,
    runners.partner.distanceKm,
    goalKm,
  );
}

function buildEcgPath(heartRates: number[]) {
  const values = heartRates.length > 0 ? heartRates : [120, 120];
  const minRate = Math.min(...values);
  const maxRate = Math.max(...values);
  const rateRange = Math.max(maxRate - minRate, 1);
  const samples = values.flatMap((rate) => {
    const normalized = (rate - minRate) / rateRange;
    const peakHeight = 42 + normalized * 18;
    return [
      0,
      -10,
      4,
      -peakHeight,
      12,
      26,
      8,
      -18,
      0,
    ];
  });

  const step = 640 / Math.max(samples.length - 1, 1);
  const points = samples.map((offset, index) => {
    const x = index * step;
    const y = 90 + offset;
    return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
  });

  return points.join(" ");
}

function buildSegmentsFromDistances(youDistanceKm: number, partnerDistanceKm: number, goalKm: number): HeartSegments {
  const safeYou = Math.max(toSafeNumber(youDistanceKm), 0);
  const safePartner = Math.max(toSafeNumber(partnerDistanceKm), 0);
  const safeGoalKm = Math.max(toSafeNumber(goalKm), 0);
  const total = safeYou + safePartner;

  if (total <= 0 || safeGoalKm <= 0) {
    return { you: 0, partner: 0 };
  }

  if (total >= safeGoalKm) {
    return {
      you: safeYou / total,
      partner: safePartner / total,
    };
  }

  return {
    you: safeYou / safeGoalKm,
    partner: safePartner / safeGoalKm,
  };
}

function toSafeNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export default App;
