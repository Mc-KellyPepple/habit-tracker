
import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { supabase } from "./lib/supabase";
import { formatHour, localHourToUtcHour, utcHourToLocalHour } from "./lib/time";
import ReminderPanel from "./ReminderPanel";
import "./App.css";

type Habit = {
  id: string;
  user_id: string;
  name: string;
  reminder_hour_utc: number;
  archived: boolean;
  created_at: string;
};

type Checkin = {
  id: string;
  habit_id: string;
  user_id: string;
  checked_at: string;
  created_at: string;
};

type SessionUser = {
  id: string;
  email?: string;
};

const localDate = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const dateOffset = (days: number) => {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return localDate(date);
};

function calculateStreak(dates: string[]) {
  const completed = new Set(dates);
  let streak = 0;
  let cursor = dateOffset(0);

  if (!completed.has(cursor)) cursor = dateOffset(-1);

  while (completed.has(cursor)) {
    streak += 1;
    const previous = new Date(`${cursor}T12:00:00`);
    previous.setDate(previous.getDate() - 1);
    cursor = localDate(previous);
  }

  return streak;
}

export default function App() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authMessage, setAuthMessage] = useState("");

  const [habits, setHabits] = useState<Habit[]>([]);
  const [checkins, setCheckins] = useState<Checkin[]>([]);
  const [loading, setLoading] = useState(false);
  const [pageError, setPageError] = useState("");
  const [habitName, setHabitName] = useState("");
  const [reminderHour, setReminderHour] = useState("9");
  const [adding, setAdding] = useState(false);
  const [busyHabit, setBusyHabit] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editHour, setEditHour] = useState("9");

  useEffect(() => {
    let alive = true;

    supabase.auth.getSession().then(({ data, error }) => {
      if (!alive) return;
      if (error) setAuthMessage(error.message);
      setUser(data.session?.user ?? null);
      setAuthReady(true);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setAuthMessage("");
    });

    return () => {
      alive = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const loadDashboard = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setPageError("");

    const [habitResult, checkinResult] = await Promise.all([
      supabase
        .from("habits")
        .select("id,user_id,name,reminder_hour_utc,archived,created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("checkins")
        .select("id,habit_id,user_id,checked_at,created_at")
        .eq("user_id", user.id)
        .order("checked_at", { ascending: false }),
    ]);

    if (habitResult.error || checkinResult.error) {
      setPageError(habitResult.error?.message ?? checkinResult.error?.message ?? "Could not load your data.");
    } else {
      setHabits((habitResult.data ?? []) as Habit[]);
      setCheckins((checkinResult.data ?? []) as Checkin[]);
    }

    setLoading(false);
  }, [user]);

  useEffect(() => {
    if (user) void loadDashboard();
    else {
      setHabits([]);
      setCheckins([]);
    }
  }, [user, loadDashboard]);

  const activeHabits = useMemo(
    () => habits.filter((habit) => !habit.archived),
    [habits],
  );

  const today = localDate();
  const completedToday = useMemo(
    () => new Set(checkins.filter((item) => item.checked_at === today).map((item) => item.habit_id)),
    [checkins, today],
  );

  const todayCount = activeHabits.filter((habit) => completedToday.has(habit.id)).length;
  const completionRate = activeHabits.length
    ? Math.round((todayCount / activeHabits.length) * 100)
    : 0;

  const handleAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAuthBusy(true);
    setAuthMessage("");

    const result = authMode === "signup"
      ? await supabase.auth.signUp({ email: email.trim(), password })
      : await supabase.auth.signInWithPassword({ email: email.trim(), password });

    if (result.error) {
      setAuthMessage(result.error.message);
    } else if (authMode === "signup" && !result.data.session) {
      setAuthMessage("Account created. Check your email to confirm your address, then sign in.");
    } else {
      setAuthMessage("");
    }

    setAuthBusy(false);
  };

  const addHabit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user || !habitName.trim()) return;

    setAdding(true);
    setPageError("");

    const { error } = await supabase.from("habits").insert({
      user_id: user.id,
      name: habitName.trim(),
      reminder_hour_utc: localHourToUtcHour(Number(reminderHour)),
    });

    if (error) setPageError(error.message);
    else {
      setHabitName("");
      await loadDashboard();
    }
    setAdding(false);
  };

  const toggleCheckin = async (habit: Habit) => {
    if (!user) return;
    setBusyHabit(habit.id);
    setPageError("");

    const existing = checkins.find(
      (item) => item.habit_id === habit.id && item.checked_at === today,
    );

    if (existing) {
      const { error } = await supabase
        .from("checkins")
        .delete()
        .eq("id", existing.id)
        .eq("user_id", user.id);

      if (error) setPageError(error.message);
    } else {
      const { error } = await supabase.from("checkins").insert({
        habit_id: habit.id,
        user_id: user.id,
        checked_at: today,
      });

      if (error) setPageError(error.code === "23505"
        ? "This habit is already checked off for today."
        : error.message);
    }

    await loadDashboard();
    setBusyHabit(null);
  };

  const startEdit = (habit: Habit) => {
    setEditingId(habit.id);
    setEditName(habit.name);
    setEditHour(String(utcHourToLocalHour(habit.reminder_hour_utc)));
    setPageError("");
  };

  const cancelEdit = () => setEditingId(null);

  const saveEdit = async (event: FormEvent<HTMLFormElement>, habit: Habit) => {
    event.preventDefault();
    const name = editName.trim();
    if (!user || !name) return;

    setBusyHabit(habit.id);
    setPageError("");

    const { data, error } = await supabase
      .from("habits")
      .update({ name, reminder_hour_utc: localHourToUtcHour(Number(editHour)) })
      .eq("id", habit.id)
      .eq("user_id", user.id)
      .eq("archived", false)
      .select("id");

    if (error) setPageError(error.message);
    else if (!data?.length) setPageError("Habit not updated. It may have been removed; refresh and try again.");
    else setEditingId(null);

    await loadDashboard();
    setBusyHabit(null);
  };

  // Same behaviour as the mobile app: "Delete" removes the habit from your list
  // but keeps its check-in history (it is archived). It can be restored below.
  const removeHabit = async (habit: Habit) => {
    if (!user) return;
    if (!window.confirm(`Delete "${habit.name}"? It will be removed from your list and its reminders will stop.`)) return;
    await setArchived(habit, true);
  };

  const restoreHabit = async (habit: Habit) => {
    if (!user) return;
    await setArchived(habit, false);
  };

  const setArchived = async (habit: Habit, archived: boolean) => {
    if (!user) return;
    setBusyHabit(habit.id);
    setPageError("");
    if (editingId === habit.id) setEditingId(null);

    const { error } = await supabase
      .from("habits")
      .update({ archived })
      .eq("id", habit.id)
      .eq("user_id", user.id);

    if (error) setPageError(error.message);
    await loadDashboard();
    setBusyHabit(null);
  };

  const deleteHabit = async (habit: Habit) => {
    if (!user) return;
    if (!window.confirm(`Permanently delete "${habit.name}" and its check-in history? This cannot be undone.`)) return;

    setBusyHabit(habit.id);
    const { error } = await supabase
      .from("habits")
      .delete()
      .eq("id", habit.id)
      .eq("user_id", user.id);

    if (error) setPageError(error.message);
    await loadDashboard();
    setBusyHabit(null);
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) setAuthMessage(error.message);
  };

  if (!authReady) {
    return <main className="screen-center"><div className="loader" />Loading Habit Tracker…</main>;
  }

  if (!user) {
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <div className="brand-mark">H</div>
          <p className="eyebrow">SMALL STEPS. REAL PROGRESS.</p>
          <h1>Make every day count.</h1>
          <p className="muted">Build consistency with simple daily habits and a clear view of your progress.</p>

          <div className="auth-tabs">
            <button className={authMode === "login" ? "selected" : ""} onClick={() => { setAuthMode("login"); setAuthMessage(""); }}>Sign in</button>
            <button className={authMode === "signup" ? "selected" : ""} onClick={() => { setAuthMode("signup"); setAuthMessage(""); }}>Create account</button>
          </div>

          <form onSubmit={handleAuth} className="stack-form">
            <label>Email address
              <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            </label>
            <label>Password
              <input type="password" autoComplete={authMode === "login" ? "current-password" : "new-password"} minLength={6} required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters" />
            </label>
            {authMessage && <p className="notice">{authMessage}</p>}
            <button className="primary-button" disabled={authBusy}>{authBusy ? "Please wait…" : authMode === "login" ? "Sign in" : "Create account"}</button>
          </form>
          <p className="auth-footnote">Your habits are private to your account.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#"><span className="brand-mark small">H</span><span>Habit<span className="brand-light">Flow</span></span></a>
        <div className="user-tools">
          <span className="user-email">{user.email}</span>
          <button className="quiet-button" onClick={signOut}>Sign out</button>
        </div>
      </header>

      <div className="dashboard">
        <section className="welcome-row">
          <div>
            <p className="eyebrow">YOUR PERSONAL HABIT SPACE</p>
            <h1>Today is a fresh start.</h1>
            <p className="muted">{new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</p>
          </div>
          <div className="date-chip"><span className="date-dot" /> Daily progress</div>
        </section>

        {pageError && <div className="error-banner">{pageError}</div>}

        <section className="stats-grid">
          <article className="stat-card accent-card">
            <span className="stat-label">Today's progress</span>
            <div className="stat-number">{completionRate}<small>%</small></div>
            <div className="progress-track"><span style={{ width: `${completionRate}%` }} /></div>
            <p>{todayCount} of {activeHabits.length} habits completed</p>
          </article>
          <article className="stat-card">
            <span className="stat-label">Active habits</span>
            <div className="stat-number">{activeHabits.length}</div>
            <p>Habits in your daily routine</p>
          </article>
          <article className="stat-card">
            <span className="stat-label">Check-ins today</span>
            <div className="stat-number">{todayCount}</div>
            <p>Small wins add up</p>
          </article>
        </section>

        <div className="content-grid">
          <section className="panel habits-panel">
            <div className="panel-heading">
              <div><h2>Your habits</h2><p className="muted">Show up for the things that matter.</p></div>
              <span className="count-pill">{activeHabits.length} active</span>
            </div>

            {loading ? <div className="empty-state">Loading your habits…</div> :
              activeHabits.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon">✦</div>
                  <h3>Your routine starts here</h3>
                  <p>Add your first habit using the form. Keep it small and achievable.</p>
                </div>
              ) : (
                <div className="habit-list">
                  {activeHabits.map((habit) => {
                    const done = completedToday.has(habit.id);
                    const dates = checkins.filter((c) => c.habit_id === habit.id).map((c) => c.checked_at);
                    if (editingId === habit.id) {
                      return (
                        <form className="habit-row habit-edit" key={habit.id} onSubmit={(e) => void saveEdit(e, habit)}>
                          <input value={editName} onChange={(e) => setEditName(e.target.value)} maxLength={80} required aria-label="Habit name" />
                          <select value={editHour} onChange={(e) => setEditHour(e.target.value)} aria-label="Reminder time">
                            {Array.from({ length: 24 }, (_, hour) => <option value={hour} key={hour}>{formatHour(hour)}</option>)}
                          </select>
                          <div className="habit-actions">
                            <button className="action-link action-save" disabled={busyHabit === habit.id || !editName.trim()}>{busyHabit === habit.id ? "Saving…" : "Save"}</button>
                            <button type="button" className="action-link" onClick={cancelEdit} disabled={busyHabit === habit.id}>Cancel</button>
                          </div>
                        </form>
                      );
                    }
                    return (
                      <article className={`habit-row ${done ? "is-done" : ""}`} key={habit.id}>
                        <button className={`check-button ${done ? "checked" : ""}`} disabled={busyHabit === habit.id} onClick={() => void toggleCheckin(habit)} aria-label={done ? `Undo ${habit.name} completion` : `Complete ${habit.name}`}>
                          {done ? "✓" : ""}
                        </button>
                        <div className="habit-info">
                          <h3>{habit.name}</h3>
                          <p>{calculateStreak(dates)} day streak <span className="bullet">·</span> Reminder {formatHour(utcHourToLocalHour(habit.reminder_hour_utc))}</p>
                        </div>
                        <div className="habit-actions">
                          <span className={`status ${done ? "status-done" : ""}`}>{done ? "Completed" : "Today"}</span>
                          <button className="action-link" onClick={() => startEdit(habit)} disabled={busyHabit === habit.id}>Edit</button>
                          <button className="action-link action-danger" onClick={() => void removeHabit(habit)} disabled={busyHabit === habit.id}>Delete</button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            <div className="archived-toggle">
              <button className="text-button" onClick={() => setShowArchived((v) => !v)}>{showArchived ? "Hide deleted habits" : `View deleted habits (${habits.filter((h) => h.archived).length})`}</button>
            </div>
            {showArchived && habits.filter((h) => h.archived).map((habit) => (
              <div className="archived-row" key={habit.id}>
                <span>{habit.name}</span>
                <div><button className="text-button" onClick={() => void restoreHabit(habit)}>Restore</button><button className="text-button danger-text" onClick={() => void deleteHabit(habit)}>Delete forever</button></div>
              </div>
            ))}
          </section>

          <aside className="panel add-panel">
            <div className="panel-heading"><div><h2>Add a habit</h2><p className="muted">Make your next good choice easy.</p></div></div>
            <form onSubmit={addHabit} className="stack-form">
              <label>Habit name
                <input value={habitName} onChange={(e) => setHabitName(e.target.value)} maxLength={80} required placeholder="e.g. Read for 20 minutes" />
              </label>
              <label>Daily reminder time
                <select value={reminderHour} onChange={(e) => setReminderHour(e.target.value)}>
                  {Array.from({ length: 24 }, (_, hour) => <option value={hour} key={hour}>{formatHour(hour)}</option>)}
                </select>
              </label>
              <button className="primary-button" disabled={adding || !habitName.trim()}>{adding ? "Adding…" : "+ Add habit"}</button>
            </form>
            <ReminderPanel userId={user.id} />
            <div className="tip-box"><span>✧</span><p><strong>Build a lasting routine</strong><br />Start with a habit you can complete even on your busiest days.</p></div>
          </aside>
        </div>
        <footer className="app-footer">Consistency over perfection. One day at a time.</footer>
      </div>
    </main>
  );
}