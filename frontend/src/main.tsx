import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Selections } from "../../backend/src/cuny/scraper";
import { Advisor } from "./advisor";
import { errorMessage, getAdvisorSchedules, getSelections, setAdvisorCommitment, type AdvisorSchedule } from "./api";
import { CourseCatalog } from "./catalog";
import {
  createPlanLink, findConflict, getSharedPlan, loadPlan, loadSavedSchedules, savePlan, saveSchedule,
  savedSchedulesKey, sectionId, type PlannedSection, type SavedSchedule,
} from "./plan";
import { Schedule } from "./schedule";
import "./style.css";

function App() {
  const [saved] = useState(loadPlan);
  const [shared] = useState(() => new URLSearchParams(window.location.search));
  const [term, setTerm] = useState(shared.get("term") ?? saved.plan[0]?.term ?? "");
  const [college, setCollege] = useState(saved.plan.find((entry) => entry.term === term)?.college ?? "");
  const [plan, setPlan] = useState(saved.plan);
  const [warning, setWarning] = useState(saved.warning);
  const [notice, setNotice] = useState("");
  const [selections, setSelections] = useState<Selections>();
  const [selectionError, setSelectionError] = useState("");
  const [selectionAttempt, setSelectionAttempt] = useState(0);
  const [loadingPlan, setLoadingPlan] = useState(shared.has("plan"));
  const [savedSchedules, setSavedSchedules] = useState<SavedSchedule[]>([]);
  const [advisorSchedules, setAdvisorSchedules] = useState<AdvisorSchedule[]>([]);
  const [advisorScheduleError, setAdvisorScheduleError] = useState("");
  const [interestVersion, setInterestVersion] = useState(0);
  const [commitPending, setCommitPending] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    getAdvisorSchedules(controller.signal).then(({ schedules }) => {
      if (!controller.signal.aborted) setAdvisorSchedules((current) => current.length ? current : schedules);
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setAdvisorScheduleError(errorMessage(error));
    });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    function reloadSchedules() {
      try {
        setSavedSchedules(loadSavedSchedules());
      } catch {
        setWarning("Your saved schedules could not be read in this browser.");
      }
    }
    function onStorage(event: StorageEvent) {
      if (event.key === savedSchedulesKey || event.key === null) reloadSchedules();
    }
    reloadSchedules();
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    getSelections(controller.signal).then((data) => {
      if (!controller.signal.aborted) setSelections(data);
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setSelectionError(errorMessage(error));
    });
    return () => controller.abort();
  }, [selectionAttempt]);

  useEffect(() => {
    const value = shared.get("plan");
    if (value === null) return;
    const controller = new AbortController();
    getSharedPlan(value, controller.signal).then((entries) => {
      if (controller.signal.aborted) return;
      const planTerm = entries[0]?.term || shared.get("term") || "";
      setTerm(planTerm);
      setCollege(entries.find((entry) => entry.term === planTerm)?.college ?? "");
      const restoredTerms = new Set(entries.map((entry) => entry.term));
      setPlan((current) => [...current.filter((entry) => !restoredTerms.has(entry.term)), ...entries]);
      setWarning("");
      const url = new URL(window.location.href);
      url.searchParams.delete("plan");
      url.searchParams.delete("term");
      window.history.replaceState(null, "", url);
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) {
        setTerm(saved.plan[0]?.term ?? "");
        setCollege(saved.plan[0]?.college ?? "");
        setWarning(error instanceof SyntaxError ? "This plan link is invalid." : errorMessage(error));
      }
    }).finally(() => {
      if (!controller.signal.aborted) setLoadingPlan(false);
    });
    return () => controller.abort();
  }, [saved, shared]);

  useEffect(() => {
    if (loadingPlan) return;
    try {
      savePlan(plan);
    } catch {
      setWarning("Your schedule could not be saved in this browser.");
    }
  }, [plan, loadingPlan]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(""), 3200);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const termLabel = selections?.terms.find(({ id }) => id === term)?.name;
  const collegeLabel = selections?.colleges.find(({ id }) => id === college)?.name;
  const termPlan = plan.filter((entry) => entry.term === term);
  const planOnlyTerms = [...new Set(plan.map((entry) => entry.term))]
    .filter((id) => !selections?.terms.some((option) => option.id === id));

  function toggle(entry: PlannedSection) {
    setPlan((current) => {
      const id = sectionId(entry);
      if (current.some((candidate) => sectionId(candidate) === id)) {
        return current.filter((candidate) => sectionId(candidate) !== id);
      }
      return findConflict(entry, current) ? current : [...current, entry];
    });
  }

  async function sharePlan() {
    try {
      await navigator.clipboard.writeText(createPlanLink(termPlan, term));
      setNotice("Schedule link copied.");
    } catch {
      setNotice("Couldn't copy the schedule link. Check your browser's clipboard permissions.");
    }
  }

  function saveCurrentSchedule(name: string) {
    if (!termPlan.length) return false;
    try {
      const updated = saveSchedule(name.trim() || "Schedule", term, termPlan);
      setSavedSchedules(updated);
      setNotice(`Saved ${updated[0].name}.`);
      return true;
    } catch {
      setWarning("Your named schedule could not be saved in this browser.");
      return false;
    }
  }

  function openSchedule(schedule: SavedSchedule) {
    setTerm(schedule.term);
    setCollege(schedule.sections[0].college);
    setPlan((current) => [...schedule.sections, ...current.filter((entry) => entry.term !== schedule.term)]);
    setNotice(`Opened ${schedule.name}.`);
  }

  async function changeCommitment(schedule: AdvisorSchedule) {
    if (commitPending) return;
    setCommitPending(true);
    setAdvisorScheduleError("");
    try {
      const { schedules } = await setAdvisorCommitment(schedule.id, !schedule.committed);
      setAdvisorSchedules(schedules);
      setNotice(schedule.committed ? "Schedule commitment withdrawn." : "Schedule committed.");
    } catch (error) {
      setAdvisorScheduleError(errorMessage(error));
    } finally {
      setCommitPending(false);
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#" aria-label="Rate My Class home">
          <span className="brand-mark">r<span>.</span></span>
          <span>rate my class</span>
        </a>
        <nav className="side-nav" aria-label="Main navigation">
          <a className="nav-item active" href="#courses"><span className="nav-icon" aria-hidden="true">⌕</span> Explore courses</a>
          <a className="nav-item" href="#planner"><span className="nav-icon" aria-hidden="true">▦</span> Schedule planner</a>
        </nav>
      </aside>
      <main className="main-content">
        <div className="page-content">
          <header className="welcome-row">
            <div>
              <h1>Schedule planner</h1>
              <p className="subtitle">{[collegeLabel ?? "CUNY", termLabel].filter(Boolean).join(" · ")}</p>
            </div>
            <button className="share-button" disabled={!termPlan.length || loadingPlan} onClick={() => void sharePlan()}>
              <span aria-hidden="true">↗</span> Share plan
            </button>
          </header>
          <div className="dashboard-grid">
            <section className="course-panel" id="courses" aria-labelledby="catalog-heading">
              <div className="section-heading"><h2 id="catalog-heading">Course catalog</h2></div>
              {selectionError ? (
                <p className="catalog-status" role="alert">
                  {selectionError} <button className="text-button" onClick={() => {
                    setSelectionError("");
                    setSelectionAttempt((attempt) => attempt + 1);
                  }}>Retry catalog</button>
                </p>
              ) : !selections && <p className="catalog-status" role="status">Loading CUNY terms and colleges…</p>}
              {(selections || planOnlyTerms.length > 0) && (
                <div className="catalog-filter-row catalog-scope">
                  <label className="field">
                    Term
                    <select value={term} disabled={loadingPlan} onChange={(event) => setTerm(event.target.value)}>
                      <option value="">Select a term</option>
                      {selections?.terms.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
                      {planOnlyTerms.map((id) => <option key={id} value={id}>Saved term {id}</option>)}
                    </select>
                  </label>
                  <label className="field">
                    College
                    <select value={college} disabled={!termLabel || loadingPlan} onChange={(event) => setCollege(event.target.value)}>
                      <option value="">Select a college</option>
                      {selections?.colleges.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
                    </select>
                  </label>
                </div>
              )}
              {termLabel && collegeLabel && !loadingPlan && (
                <CourseCatalog key={`${term}:${college}`} term={term} college={college} plan={plan} onToggle={toggle}
                  interestVersion={interestVersion} />
              )}
            </section>
            <Schedule plan={termPlan} colleges={selections?.colleges ?? []} terms={selections?.terms ?? []} loading={loadingPlan}
              savedSchedules={savedSchedules} onSave={saveCurrentSchedule} onOpen={openSchedule}
              advisorSchedules={advisorSchedules} advisorError={advisorScheduleError} commitPending={commitPending}
              onCommit={(schedule) => void changeCommitment(schedule)}
              onRemove={toggle} onClear={() => setPlan((current) => current.filter((entry) => entry.term !== term))} />
          </div>
        </div>
      </main>
      {warning && <div className="storage-warning" role="status">{warning} <button type="button" onClick={() => setWarning("")}>Dismiss</button></div>}
      {notice && <div className="toast" role="status">{notice}</div>}
      <Advisor selections={selections} catalog={{ term, college }} onGoals={() => setInterestVersion((version) => version + 1)}
        onSave={(schedule) => {
          setAdvisorScheduleError("");
          setAdvisorSchedules((current) => [schedule, ...current.filter(({ id }) => id !== schedule.id)]);
        }}
        onView={(schedule) => {
          openSchedule(schedule);
          requestAnimationFrame(() => document.getElementById("planner")?.scrollIntoView({ block: "start" }));
        }} />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
