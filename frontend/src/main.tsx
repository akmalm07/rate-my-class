import { useEffect, useMemo, useState } from "react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

type Day = "Mon" | "Tue" | "Wed" | "Thu" | "Fri";
type Semester = "Fall 2026" | "Spring 2027";

type Course = {
  id: string;
  code: string;
  title: string;
  credits: number;
  instructor: string;
  rating: number;
  reviews: number;
  difficulty: number;
  wouldTakeAgain: number;
  semesters: Semester[];
  campus: string;
  genEd: string;
  tags: string[];
  days: Day[];
  start: string;
  end: string;
  format: string;
  color: string;
};

type SavedSchedule = {
  id: string;
  name: string;
  semester: Semester;
  courseIds: string[];
  favorite: boolean;
};

const days: Day[] = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const semesters: Semester[] = ["Fall 2026", "Spring 2027"];
const courses: Course[] = [
  {
    id: "csci-210",
    code: "CSCI 210",
    title: "Data Structures & Algorithms",
    credits: 3,
    instructor: "Dr. Maya Patel",
    rating: 4.8,
    reviews: 42,
    difficulty: 3.2,
    wouldTakeAgain: 94,
    semesters: ["Fall 2026", "Spring 2027"],
    campus: "City College",
    genEd: "STEM",
    tags: ["Clear lectures", "Helpful"],
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
    difficulty: 3.8,
    wouldTakeAgain: 87,
    semesters: ["Fall 2026"],
    campus: "City College",
    genEd: "Math & Quantitative Reasoning",
    tags: ["Lots of homework"],
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
    difficulty: 2.4,
    wouldTakeAgain: 98,
    semesters: ["Fall 2026", "Spring 2027"],
    campus: "Queens College",
    genEd: "English Composition",
    tags: ["Engaging", "Good feedback"],
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
    difficulty: 3.1,
    wouldTakeAgain: 79,
    semesters: ["Fall 2026", "Spring 2027"],
    campus: "Baruch College",
    genEd: "Social Sciences",
    tags: ["Attendance matters"],
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
    difficulty: 2.7,
    wouldTakeAgain: 83,
    semesters: ["Fall 2026"],
    campus: "Queens College",
    genEd: "World Cultures",
    tags: ["Interesting material"],
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
    difficulty: 2.9,
    wouldTakeAgain: 91,
    semesters: ["Spring 2027"],
    campus: "Brooklyn College",
    genEd: "Individual & Society",
    tags: ["Flexible", "Clear lectures"],
    days: ["Tue", "Thu"],
    start: "09:00",
    end: "10:15",
    format: "Online",
    color: "pink",
  },
];

const STORAGE_KEY = "rate-my-class-schedule";
const SAVED_SCHEDULES_KEY = "rate-my-class-saved-schedules";
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
  const requestedSemester = new URLSearchParams(window.location.search).get("semester");
  const semester: Semester = semesters.includes(requestedSemester as Semester)
    ? requestedSemester as Semester
    : "Fall 2026";
  if (sharedPlan !== null) {
    const ids = sharedPlan ? Array.from(new Set(sharedPlan.split(","))) : [];
    if (ids.every((id) => courses.some((course) => course.id === id))) {
      return { semester, plans: { [semester]: ids } as Partial<Record<Semester, string[]>>, error: "" };
    }
    return { semester, plans: {}, error: "This shared plan contains an unknown course, so a new one was started." };
  }

  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return { semester, plans: {}, error: "" };
    const parsed: unknown = JSON.parse(saved);
    if (Array.isArray(parsed)) {
      if (parsed.some((id) => typeof id !== "string" || !courses.some((course) => course.id === id))) {
        return { semester, plans: {}, error: "Your saved plan could not be read, so a new one was started." };
      }
      return { semester, plans: { "Fall 2026": parsed as string[] }, error: "" };
    }
    if (parsed && typeof parsed === "object") {
      const plans: Partial<Record<Semester, string[]>> = {};
      for (const term of semesters) {
        const ids = (parsed as Record<string, unknown>)[term];
        if (ids === undefined) continue;
        if (
          !Array.isArray(ids) ||
          ids.some((id) => typeof id !== "string" || !courses.some((course) => course.id === id))
        ) {
          return { semester, plans: {}, error: "Your saved plan could not be read, so a new one was started." };
        }
        plans[term] = ids as string[];
      }
      return { semester, plans, error: "" };
    }
    return { semester, plans: {}, error: "Your saved plan could not be read, so a new one was started." };
  } catch {
    return { semester, plans: {}, error: "Your saved plan could not be read, so a new one was started." };
  }
}

function loadSavedSchedules(): { schedules: SavedSchedule[]; error: string } {
  try {
    const saved = localStorage.getItem(SAVED_SCHEDULES_KEY);
    if (!saved) return { schedules: [], error: "" };
    const parsed: unknown = JSON.parse(saved);
    if (
      !Array.isArray(parsed) ||
      parsed.some((schedule) =>
        !schedule ||
        typeof schedule.id !== "string" ||
        typeof schedule.name !== "string" ||
        !semesters.includes(schedule.semester) ||
        typeof schedule.favorite !== "boolean" ||
        !Array.isArray(schedule.courseIds) ||
        schedule.courseIds.some((id: unknown) =>
          typeof id !== "string" || !courses.some((course) => course.id === id),
        ),
      )
    ) {
      return { schedules: [], error: "Saved schedules could not be read and were not loaded." };
    }
    return { schedules: parsed as SavedSchedule[], error: "" };
  } catch {
    return { schedules: [], error: "Saved schedules could not be read and were not loaded." };
  }
}

function App() {
  const [query, setQuery] = useState("");
  const [scheduleLoad] = useState(loadSchedule);
  const [semester, setSemester] = useState<Semester>(scheduleLoad.semester);
  const [plans, setPlans] = useState<Partial<Record<Semester, string[]>>>(scheduleLoad.plans);
  const selectedIds = plans[semester] ?? [];
  const [savedSchedulesLoad] = useState(loadSavedSchedules);
  const [savedSchedules, setSavedSchedules] = useState(savedSchedulesLoad.schedules);
  const [scheduleName, setScheduleName] = useState("");
  const [storageError, setStorageError] = useState(scheduleLoad.error || savedSchedulesLoad.error);
  const [notice, setNotice] = useState("");
  const [minimumRating, setMinimumRating] = useState("0");
  const [maximumDifficulty, setMaximumDifficulty] = useState("5");
  const [creditsFilter, setCreditsFilter] = useState("any");
  const [formatFilter, setFormatFilter] = useState("any");
  const [dayFilter, setDayFilter] = useState("any");
  const [minimumTakeAgain, setMinimumTakeAgain] = useState("0");
  const [minimumReviews, setMinimumReviews] = useState("0");
  const [genEdFilter, setGenEdFilter] = useState("any");
  const [campusFilter, setCampusFilter] = useState("any");
  const [favoritesOnly, setFavoritesOnly] = useState(false);

  const selectedCourses = useMemo(
    () => courses.filter((course) => course.semesters.includes(semester) && selectedIds.includes(course.id)),
    [selectedIds, semester],
  );
  const filteredCourses = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return courses.filter((course) => {
      const matchesQuery = `${course.code} ${course.title} ${course.instructor} ${course.campus} ${course.tags.join(" ")}`
        .toLowerCase()
        .includes(normalizedQuery);
      return course.semesters.includes(semester) &&
        matchesQuery &&
        course.rating >= Number(minimumRating) &&
        course.difficulty <= Number(maximumDifficulty) &&
        (creditsFilter === "any" || course.credits === Number(creditsFilter)) &&
        (formatFilter === "any" || course.format === formatFilter) &&
        (dayFilter === "any" || course.days.includes(dayFilter as Day)) &&
        course.wouldTakeAgain >= Number(minimumTakeAgain) &&
        course.reviews >= Number(minimumReviews) &&
        (genEdFilter === "any" || course.genEd === genEdFilter) &&
        (campusFilter === "any" || course.campus === campusFilter) &&
        (!favoritesOnly || savedSchedules.some(
          (schedule) => schedule.favorite && schedule.semester === semester && schedule.courseIds.includes(course.id),
        ));
    });
  }, [query, semester, minimumRating, maximumDifficulty, creditsFilter, formatFilter, dayFilter, minimumTakeAgain, minimumReviews, genEdFilter, campusFilter, favoritesOnly, savedSchedules]);
  const totalCredits = selectedCourses.reduce((total, course) => total + course.credits, 0);
  const termSavedSchedules = savedSchedules
    .filter((schedule) => schedule.semester === semester)
    .sort((first, second) => Number(second.favorite) - Number(first.favorite));

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(plans));
      setStorageError((error) => error === "Your plan could not be saved in this browser." ? "" : error);
    } catch {
      setStorageError("Your plan could not be saved in this browser.");
    }
  }, [plans]);

  useEffect(() => {
    try {
      localStorage.setItem(SAVED_SCHEDULES_KEY, JSON.stringify(savedSchedules));
      setStorageError((error) => error === "Saved schedules could not be saved in this browser." ? "" : error);
    } catch {
      setStorageError("Saved schedules could not be saved in this browser.");
    }
  }, [savedSchedules]);

  const activeFiltersCount = [
    minimumRating !== "0",
    maximumDifficulty !== "5",
    creditsFilter !== "any",
    formatFilter !== "any",
    dayFilter !== "any",
    minimumTakeAgain !== "0",
    minimumReviews !== "0",
    genEdFilter !== "any",
    campusFilter !== "any",
    favoritesOnly,
  ].filter(Boolean).length;

  function updateSelectedIds(update: (ids: string[]) => string[]) {
    setPlans((current) => ({ ...current, [semester]: update(current[semester] ?? []) }));
  }

  function getConflict(course: Course) {
    return selectedCourses.find(
      (selected) =>
        selected.days.some((day) => course.days.includes(day)) &&
        toMinutes(course.start) < toMinutes(selected.end) &&
        toMinutes(course.end) > toMinutes(selected.start),
    );
  }

  function addCourse(course: Course) {
    if (!course.semesters.includes(semester)) return;
    if (getConflict(course)) return;
    updateSelectedIds((ids) => ids.includes(course.id) ? ids : [...ids, course.id]);
    setNotice(`${course.code} added to your plan`);
    window.setTimeout(() => setNotice(""), 2600);
  }

  function removeCourse(course: Course) {
    updateSelectedIds((ids) => ids.filter((id) => id !== course.id));
    setNotice(`${course.code} removed from your plan`);
    window.setTimeout(() => setNotice(""), 2600);
  }

  function clearSchedule() {
    updateSelectedIds(() => []);
    setNotice("Your plan is clear and ready for a fresh start");
    window.setTimeout(() => setNotice(""), 2600);
  }

  async function sharePlan() {
    const shareUrl = new URL(window.location.href);
    shareUrl.searchParams.set("plan", selectedIds.join(","));
    shareUrl.searchParams.set("semester", semester);
    try {
      await navigator.clipboard.writeText(shareUrl.toString());
      setNotice("Shareable plan link copied");
    } catch {
      setNotice("Couldn't copy the plan link. Check your browser's clipboard permissions.");
    }
    window.setTimeout(() => setNotice(""), 3200);
  }

  function saveSchedule() {
    const name = scheduleName.trim();
    if (!name) {
      setNotice("Enter a name for this schedule first");
      window.setTimeout(() => setNotice(""), 2600);
      return;
    }
    if (selectedIds.length === 0) {
      setNotice("Add at least one course before saving a schedule");
      window.setTimeout(() => setNotice(""), 2600);
      return;
    }
    setSavedSchedules((saved) => [
      ...saved,
      { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, name, semester, courseIds: [...selectedIds], favorite: false },
    ]);
    setScheduleName("");
    setNotice(`${name} saved`);
    window.setTimeout(() => setNotice(""), 2600);
  }

  function loadSavedSchedule(schedule: SavedSchedule) {
    setSemester(schedule.semester);
    setPlans((current) => ({ ...current, [schedule.semester]: [...schedule.courseIds] }));
    setNotice(`${schedule.name} loaded`);
    window.setTimeout(() => setNotice(""), 2600);
  }

  function toggleFavorite(scheduleId: string) {
    setSavedSchedules((saved) =>
      saved.map((schedule) => schedule.id === scheduleId ? { ...schedule, favorite: !schedule.favorite } : schedule),
    );
  }

  function removeSavedSchedule(scheduleId: string) {
    setSavedSchedules((saved) => saved.filter((schedule) => schedule.id !== scheduleId));
  }

  function resetFilters() {
    setMinimumRating("0");
    setMaximumDifficulty("5");
    setCreditsFilter("any");
    setFormatFilter("any");
    setDayFilter("any");
    setMinimumTakeAgain("0");
    setMinimumReviews("0");
    setGenEdFilter("any");
    setCampusFilter("any");
    setFavoritesOnly(false);
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
            <strong>{semester}</strong>
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
            <span className="campus-pill"><span className="campus-dot" /> CUNY · {semester}</span>
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
            <span><strong>Demo catalog.</strong> Course offerings, instructor ratings, difficulty, and “would take again” values are sample data—not official CUNY or Rate My Professors data.</span>
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

              <div className="semester-switcher" aria-label="Select semester">
                <span>SEMESTER</span>
                {semesters.map((term) => (
                  <button
                    className={`semester-button ${semester === term ? "selected" : ""}`}
                    key={term}
                    onClick={() => setSemester(term)}
                    aria-pressed={semester === term}
                  >
                    {term}
                  </button>
                ))}
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
                <button className={`filter-chip ${query === "" ? "selected" : ""}`} onClick={() => setQuery("")}>All courses</button>
                <button className={`filter-chip ${query === "CSCI" ? "selected" : ""}`} onClick={() => setQuery("CSCI")}>Computer science</button>
                <button className={`filter-chip ${query === "math" ? "selected" : ""}`} onClick={() => setQuery("math")}>Math</button>
              </div>

              <details className="filters-panel">
                <summary><span>Filters</span><span className="filter-count">{activeFiltersCount || "Optional"}</span><span className="filter-chevron">⌄</span></summary>
                <div className="filter-controls">
                  <label className="filter-control">
                    <span>Min. professor rating</span>
                    <select value={minimumRating} onChange={(event) => setMinimumRating(event.target.value)}>
                      <option value="0">Any rating</option><option value="3">3.0+</option><option value="3.5">3.5+</option><option value="4">4.0+</option><option value="4.5">4.5+</option>
                    </select>
                  </label>
                  <label className="filter-control">
                    <span>Max. difficulty</span>
                    <select value={maximumDifficulty} onChange={(event) => setMaximumDifficulty(event.target.value)}>
                      <option value="5">Any difficulty</option><option value="2">2.0 or less</option><option value="3">3.0 or less</option><option value="4">4.0 or less</option>
                    </select>
                  </label>
                  <label className="filter-control">
                    <span>Credits</span>
                    <select value={creditsFilter} onChange={(event) => setCreditsFilter(event.target.value)}>
                      <option value="any">Any credits</option><option value="3">3 credits</option><option value="4">4 credits</option>
                    </select>
                  </label>
                  <label className="filter-control">
                    <span>Class format</span>
                    <select value={formatFilter} onChange={(event) => setFormatFilter(event.target.value)}>
                      <option value="any">Any format</option><option>In person</option><option>Online</option><option>Hybrid</option>
                    </select>
                  </label>
                  <label className="filter-control">
                    <span>Meeting day</span>
                    <select value={dayFilter} onChange={(event) => setDayFilter(event.target.value)}>
                      <option value="any">Any day</option>{days.map((day) => <option key={day} value={day}>{day}</option>)}
                    </select>
                  </label>
                  <label className="filter-control">
                    <span>Would take again</span>
                    <select value={minimumTakeAgain} onChange={(event) => setMinimumTakeAgain(event.target.value)}>
                      <option value="0">Any response</option><option value="70">70%+</option><option value="80">80%+</option><option value="90">90%+</option>
                    </select>
                  </label>
                  <label className="filter-control">
                    <span>Min. professor reviews</span>
                    <select value={minimumReviews} onChange={(event) => setMinimumReviews(event.target.value)}>
                      <option value="0">Any review count</option><option value="10">10+</option><option value="25">25+</option><option value="50">50+</option>
                    </select>
                  </label>
                  <label className="filter-control">
                    <span>Requirement area</span>
                    <select value={genEdFilter} onChange={(event) => setGenEdFilter(event.target.value)}>
                      <option value="any">Any requirement</option>{Array.from(new Set(courses.map((course) => course.genEd))).map((area) => <option key={area}>{area}</option>)}
                    </select>
                  </label>
                  <label className="filter-control">
                    <span>Campus</span>
                    <select value={campusFilter} onChange={(event) => setCampusFilter(event.target.value)}>
                      <option value="any">Any campus</option>{Array.from(new Set(courses.map((course) => course.campus))).map((campus) => <option key={campus}>{campus}</option>)}
                    </select>
                  </label>
                  <label className="favorite-filter">
                    <input type="checkbox" checked={favoritesOnly} onChange={(event) => setFavoritesOnly(event.target.checked)} />
                    <span>Only show courses in my favorite schedules</span>
                  </label>
                  {activeFiltersCount > 0 && <button className="reset-filters" onClick={resetFilters}>Reset filters</button>}
                </div>
              </details>

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
                        <span className="meta-divider" />
                        <span className="difficulty-label">Diff.</span><strong>{course.difficulty.toFixed(1)}</strong>
                        <span className="take-again">{course.wouldTakeAgain}% again</span>
                      </div>
                      <div className="course-details">
                        <span className="detail-item"><span className="detail-icon">◷</span>{course.days.join(", ")} · {formatTime(course.start)}–{formatTime(course.end)}</span>
                        <span className="detail-item"><span className="detail-icon">⌖</span>{course.format}</span>
                        <span className="detail-item"><span className="detail-icon">⌂</span>{course.campus}</span>
                        <span className="detail-item"><span className="detail-icon">◇</span>{course.genEd}</span>
                      </div>
                      <div className="course-tags">{course.tags.map((tag) => <span className="course-tag" key={tag}>{tag}</span>)}</div>
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
              <div className="catalog-footnote">Showing sample courses <span>·</span> {semester} <a href="#planner">About this data</a></div>
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
              <div className="save-schedule-row">
                <label className="visually-hidden" htmlFor="schedule-name">Schedule name</label>
                <input id="schedule-name" value={scheduleName} onChange={(event) => setScheduleName(event.target.value)} placeholder="Name this schedule" maxLength={40} />
                <button onClick={saveSchedule}>Save</button>
              </div>
              {termSavedSchedules.length > 0 && (
                <div className="saved-schedules">
                  <div className="saved-title">SAVED {semester.toUpperCase()} SCHEDULES</div>
                  {termSavedSchedules.map((schedule) => (
                    <div className="saved-schedule" key={schedule.id}>
                      <button className="saved-load" onClick={() => loadSavedSchedule(schedule)}>
                        <span>{schedule.favorite ? "★" : "☆"}</span>
                        <strong>{schedule.name}</strong>
                        <small>{schedule.courseIds.length} classes</small>
                      </button>
                      <button className={`saved-favorite ${schedule.favorite ? "favorited" : ""}`} onClick={() => toggleFavorite(schedule.id)} aria-label={schedule.favorite ? `Unfavorite ${schedule.name}` : `Favorite ${schedule.name}`}>★</button>
                      <button className="saved-delete" onClick={() => removeSavedSchedule(schedule.id)} aria-label={`Delete ${schedule.name}`}>×</button>
                    </div>
                  ))}
                </div>
              )}
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
