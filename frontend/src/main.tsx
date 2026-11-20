import { useEffect, useMemo, useState } from "react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

type Day = "Mon" | "Tue" | "Wed" | "Thu" | "Fri";

type Course = {
  id: string;
  code: string;
  title: string;
  credits: number;
  instructor: string;
  rating: number;
  reviews: number;
  days: Day[];
  start: string;
  end: string;
  format: string;
  color: string;
};

const days: Day[] = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const courses: Course[] = [
  {
    id: "csci-210",
    code: "CSCI 210",
    title: "Data Structures & Algorithms",
    credits: 3,
    instructor: "Dr. Maya Patel",
    rating: 4.8,
    reviews: 42,
    days: ["Mon", "Wed"],
    start: "09:30",
    end: "10:45",
    format: "In person",
    color: "lavender",
  },
  {
    id: "math-160",
    code: "MATH 160",
    title: "Calculus I",
    credits: 4,
    instructor: "Prof. Jordan Lee",
    rating: 4.6,
    reviews: 31,
    days: ["Tue", "Thu"],
    start: "11:00",
    end: "12:15",
    format: "In person",
    color: "mint",
  },
  {
    id: "engl-101",
    code: "ENGL 101",
    title: "College Writing",
    credits: 3,
    instructor: "Dr. Sam Rivera",
    rating: 4.9,
    reviews: 56,
    days: ["Mon", "Wed"],
    start: "11:00",
    end: "12:15",
    format: "In person",
    color: "peach",
  },
  {
    id: "econ-201",
    code: "ECON 201",
    title: "Principles of Microeconomics",
    credits: 3,
    instructor: "Prof. Alex Chen",
    rating: 4.3,
    reviews: 27,
    days: ["Tue", "Thu"],
    start: "14:00",
    end: "15:15",
    format: "Hybrid",
    color: "blue",
  },
  {
    id: "hist-110",
    code: "HIST 110",
    title: "The Modern World",
    credits: 3,
    instructor: "Dr. Taylor Morgan",
    rating: 4.5,
    reviews: 19,
    days: ["Mon", "Wed", "Fri"],
    start: "13:00",
    end: "13:50",
    format: "In person",
    color: "yellow",
  },
  {
    id: "psych-101",
    code: "PSYCH 101",
    title: "Introduction to Psychology",
    credits: 3,
    instructor: "Prof. Casey Brooks",
    rating: 4.7,
    reviews: 38,
    days: ["Tue", "Thu"],
    start: "09:00",
    end: "10:15",
    format: "Online",
    color: "pink",
  },
];

const STORAGE_KEY = "rate-my-class-schedule";
const calendarStart = 8;
const calendarEnd = 20;
const hourHeight = 56;

function toMinutes(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function formatTime(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  const suffix = hours >= 12 ? "PM" : "AM";
  return `${hours % 12 || 12}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

function loadSchedule() {
  const sharedPlan = new URLSearchParams(window.location.search).get("plan");
  if (sharedPlan !== null) {
    const ids = sharedPlan ? Array.from(new Set(sharedPlan.split(","))) : [];
    if (ids.every((id) => courses.some((course) => course.id === id))) {
      return { ids, error: "" };
    }
    return { ids: [] as string[], error: "This shared plan contains an unknown course, so a new one was started." };
  }

  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return { ids: [] as string[], error: "" };
    const parsed: unknown = JSON.parse(saved);
    if (
      !Array.isArray(parsed) ||
      parsed.some((id) => typeof id !== "string" || !courses.some((course) => course.id === id))
    ) {
      return { ids: [] as string[], error: "Your saved plan could not be read, so a new one was started." };
    }
    return { ids: parsed as string[], error: "" };
  } catch {
    return { ids: [] as string[], error: "Your saved plan could not be read, so a new one was started." };
  }
}

function App() {
  const [query, setQuery] = useState("");
  const [scheduleLoad] = useState(loadSchedule);
  const [selectedIds, setSelectedIds] = useState<string[]>(scheduleLoad.ids);
  const [storageError, setStorageError] = useState(scheduleLoad.error);
  const [notice, setNotice] = useState("");

  const selectedCourses = useMemo(
    () => courses.filter((course) => selectedIds.includes(course.id)),
    [selectedIds],
  );
  const filteredCourses = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return courses.filter((course) =>
      `${course.code} ${course.title} ${course.instructor}`.toLowerCase().includes(normalizedQuery),
    );
  }, [query]);
  const totalCredits = selectedCourses.reduce((total, course) => total + course.credits, 0);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(selectedIds));
      setStorageError("");
    } catch {
      setStorageError("Your plan could not be saved in this browser.");
    }
  }, [selectedIds]);

  function getConflict(course: Course) {
    return selectedCourses.find(
      (selected) =>
        selected.days.some((day) => course.days.includes(day)) &&
        toMinutes(course.start) < toMinutes(selected.end) &&
        toMinutes(course.end) > toMinutes(selected.start),
    );
  }

  function addCourse(course: Course) {
    if (getConflict(course)) return;
    setSelectedIds((ids) => [...ids, course.id]);
    setNotice(`${course.code} added to your plan`);
    window.setTimeout(() => setNotice(""), 2600);
  }

  function removeCourse(course: Course) {
    setSelectedIds((ids) => ids.filter((id) => id !== course.id));
    setNotice(`${course.code} removed from your plan`);
    window.setTimeout(() => setNotice(""), 2600);
  }

  function clearSchedule() {
    setSelectedIds([]);
    setNotice("Your plan is clear and ready for a fresh start");
    window.setTimeout(() => setNotice(""), 2600);
  }

  async function sharePlan() {
    const shareUrl = new URL(window.location.href);
    shareUrl.searchParams.set("plan", selectedIds.join(","));
    try {
      await navigator.clipboard.writeText(shareUrl.toString());
      setNotice("Shareable plan link copied");
    } catch {
      setNotice("Couldn't copy the plan link. Check your browser's clipboard permissions.");
    }
    window.setTimeout(() => setNotice(""), 3200);
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#" aria-label="Rate My Class home">
          <span className="brand-mark">r<span>.</span></span>
          <span>rate my class</span>
        </a>

        <div className="sidebar-label">WORKSPACE</div>
        <nav className="side-nav" aria-label="Main navigation">
          <a className="nav-item active" href="#planner">
            <span className="nav-icon">▦</span> Schedule planner
          </a>
          <a className="nav-item" href="#courses">
            <span className="nav-icon">⌕</span> Explore courses
          </a>
        </nav>

        <div className="sidebar-divider" />
        <div className="sidebar-label">YOUR PLAN</div>
        <div className="plan-card">
          <span className="plan-dot" />
          <div>
            <strong>Fall 2026</strong>
            <span>Draft schedule</span>
          </div>
          <span className="more-icon" aria-hidden="true">···</span>
        </div>

        <div className="sidebar-bottom">
          <div className="help-card">
            <span className="help-sparkle">✳</span>
            <strong>Plan with confidence</strong>
            <p>Compare classes, find a good fit, and build a week that works for you.</p>
          </div>
          <div className="profile">
            <div className="avatar">S</div>
            <div className="profile-copy"><strong>Student</strong><span>My workspace</span></div>
            <span className="more-icon" aria-hidden="true">···</span>
          </div>
        </div>
      </aside>

      <main className="main-content" id="planner">
        <header className="topbar">
          <div className="breadcrumb">Workspace <span>/</span> <strong>Schedule planner</strong></div>
          <div className="topbar-right">
            <span className="campus-pill"><span className="campus-dot" /> CUNY · Fall 2026</span>
            <button className="icon-button notification-button" aria-label="Notifications">♧<i /></button>
            <div className="avatar top-avatar">S</div>
          </div>
        </header>

        <div className="page-content">
          <section className="welcome-row">
            <div>
              <div className="eyebrow"><span className="eyebrow-line" /> YOUR SEMESTER, YOUR WAY</div>
              <h1>Make a schedule<br className="mobile-break" /> that works for you<span className="title-period">.</span></h1>
              <p className="subtitle">Find your classes, compare the details, and map out a week you’ll love.</p>
            </div>
            <button className="share-button" onClick={() => void sharePlan()}>
              <span aria-hidden="true">↗</span> Share plan
            </button>
          </section>

          <div className="demo-banner">
            <span className="demo-icon">i</span>
            <span><strong>Demo catalog.</strong> Sample course times and instructor ratings are placeholders, not official CUNY data.</span>
          </div>

          <div className="dashboard-grid">
            <section className="course-panel" id="courses">
              <div className="section-heading">
                <div>
                  <div className="section-kicker">COURSE CATALOG</div>
                  <h2>Find your next class</h2>
                </div>
                <span className="result-count">{filteredCourses.length} courses</span>
              </div>

              <label className="search-box">
                <span className="search-icon" aria-hidden="true">⌕</span>
                <input
                  type="search"
                  placeholder="Search by course name or code..."
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  aria-label="Search courses by name, code, or instructor"
                />
                <kbd>/</kbd>
              </label>

              <div className="filter-row">
                <span className="filter-label">SUGGESTED</span>
                <button className="filter-chip selected" onClick={() => setQuery("")}>All courses</button>
                <button className="filter-chip" onClick={() => setQuery("CSCI")}>Computer science</button>
                <button className="filter-chip" onClick={() => setQuery("math")}>Math</button>
              </div>

              <div className="course-list" aria-live="polite">
                {filteredCourses.map((course) => {
                  const isSelected = selectedIds.includes(course.id);
                  const conflict = !isSelected ? getConflict(course) : undefined;
                  return (
                    <article className={`course-card ${isSelected ? "is-selected" : ""}`} key={course.id}>
                      <div className="course-card-top">
                        <div className={`course-icon ${course.color}`}>{course.code.split(" ")[0].slice(0, 2)}</div>
                        <div className="course-heading">
                          <div className="course-code">{course.code}<span className="course-separator">·</span>{course.credits} credits</div>
                          <h3>{course.title}</h3>
                        </div>
                        <button
                          className={`add-button ${isSelected ? "added" : ""}`}
                          onClick={() => isSelected ? removeCourse(course) : addCourse(course)}
                          disabled={Boolean(conflict)}
                          aria-label={isSelected ? `Remove ${course.code} from schedule` : conflict ? `${course.code} conflicts with ${conflict.code}` : `Add ${course.code} to schedule`}
                          title={conflict ? `Conflicts with ${conflict.code}` : undefined}
                        >
                          {isSelected ? <><span>✓</span> Added</> : <><span>＋</span> Add</>}
                        </button>
                      </div>
                      <div className="course-meta">
                        <span className="professor-avatar">{course.instructor.split(" ").slice(-1)[0][0]}</span>
                        <span>{course.instructor}</span>
                        <span className="meta-divider" />
                        <span className="rating-star">★</span>
                        <strong>{course.rating.toFixed(1)}</strong>
                        <span className="review-count">({course.reviews})</span>
                      </div>
                      <div className="course-details">
                        <span className="detail-item"><span className="detail-icon">◷</span>{course.days.join(", ")} · {formatTime(course.start)}–{formatTime(course.end)}</span>
                        <span className="detail-item"><span className="detail-icon">⌖</span>{course.format}</span>
                      </div>
                      {conflict && <div className="conflict-note">Time conflict with {conflict.code} in your plan</div>}
                    </article>
                  );
                })}
                {filteredCourses.length === 0 && (
                  <div className="empty-search">
                    <span>⌕</span>
                    <strong>No courses found</strong>
                    <p>Try a different course name, code, or instructor.</p>
                    <button className="text-button" onClick={() => setQuery("")}>Clear search</button>
                  </div>
                )}
              </div>
              <div className="catalog-footnote">Showing sample courses <span>·</span> Fall 2026 <a href="#planner">About this data</a></div>
            </section>

            <section className="schedule-panel" aria-label="Weekly schedule">
              <div className="schedule-header">
                <div>
                  <div className="section-kicker">YOUR WEEK AT A GLANCE</div>
                  <div className="schedule-title-row"><h2>My schedule</h2><span className="draft-badge">DRAFT</span></div>
                </div>
                {selectedCourses.length > 0 && <button className="clear-button" onClick={clearSchedule}>Clear all</button>}
              </div>
              <div className="schedule-summary">
                <div><strong>{selectedCourses.length}</strong><span>classes</span></div>
                <span className="summary-divider" />
                <div><strong>{totalCredits}</strong><span>credits</span></div>
                <div className="week-label">MON — FRI</div>
              </div>
              <div className="calendar-scroll">
                <div className="calendar">
                  <div className="calendar-head">
                    <div className="time-spacer" />
                    {days.map((day) => <div className="day-heading" key={day}>{day}</div>)}
                  </div>
                  <div className="calendar-body">
                    <div className="time-labels">
                      {Array.from({ length: calendarEnd - calendarStart }, (_, index) => {
                        const hour = calendarStart + index;
                        return <div className="time-label" key={hour}>{hour % 12 || 12} {hour >= 12 ? "PM" : "AM"}</div>;
                      })}
                    </div>
                    <div className="day-columns">
                      {days.map((day) => (
                        <div className="day-column" key={day}>
                          {Array.from({ length: calendarEnd - calendarStart }, (_, index) => <div className="hour-cell" key={index} />)}
                          {selectedCourses.filter((course) => course.days.includes(day)).map((course) => {
                            const startMinutes = toMinutes(course.start);
                            const top = ((startMinutes - calendarStart * 60) / 60) * hourHeight;
                            const height = ((toMinutes(course.end) - startMinutes) / 60) * hourHeight;
                            return (
                              <div
                                className={`calendar-event event-${course.color}`}
                                key={`${day}-${course.id}`}
                                style={{ top: `${top}px`, height: `${height}px` }}
                                title={`${course.code}: ${course.title}, ${formatTime(course.start)}–${formatTime(course.end)}`}
                              >
                                <strong>{course.code}</strong>
                                <span>{formatTime(course.start)}</span>
                              </div>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                    {selectedCourses.length === 0 && (
                      <div className="calendar-empty">
                        <span className="calendar-empty-icon">＋</span>
                        <strong>Your week starts here</strong>
                        <span>Add a course to see it on your schedule.</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="calendar-legend">
                <span className="legend-dot lavender-dot" /> Added classes
                <span className="legend-note">Times shown in local time</span>
              </div>
              <div className="schedule-tip"><span>✦</span><p><strong>A little breathing room goes a long way.</strong><br />Leave time between classes for a coffee, a commute, or just a reset.</p></div>
            </section>
          </div>
          <footer className="page-footer"><span>Made for students, by students.</span><span>Planning tool only · Enrollment happens through your college</span></footer>
        </div>
      </main>
      {storageError && <div className="storage-warning" role="status">{storageError}</div>}
      {notice && <div className="toast" role="status">{notice}</div>}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
