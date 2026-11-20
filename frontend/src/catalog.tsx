import { useEffect, useState, type FormEvent } from "react";
import type { CourseSearchResponse, Option } from "../../backend/src/cuny/scraper";
import { errorMessage, getCourses, getRating, getSubjects, pageSize, type Catalog, type CourseFilters } from "./api";
import { findConflict, sectionId, type PlannedSection } from "./plan";

interface CatalogProps extends Catalog {
  plan: PlannedSection[];
  onToggle: (entry: PlannedSection) => void;
}

export function CourseCatalog({ term, college, plan, onToggle }: CatalogProps) {
  const [subjects, setSubjects] = useState<Option[]>([]);
  const [subjectStatus, setSubjectStatus] = useState("Loading subjects…");
  const [subjectAttempt, setSubjectAttempt] = useState(0);
  const [query, setQuery] = useState("");
  const [subject, setSubject] = useState("");
  const [openOnly, setOpenOnly] = useState(false);
  const [request, setRequest] = useState<{ filters: CourseFilters; offset: number }>();
  const [result, setResult] = useState<CourseSearchResponse>();
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    getSubjects({ term, college }, controller.signal).then((choices) => {
      if (controller.signal.aborted) return;
      setSubjects(choices);
      setSubjectStatus("");
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setSubjectStatus(errorMessage(error));
    });
    return () => controller.abort();
  }, [term, college, subjectAttempt]);

  useEffect(() => {
    if (!request) return;
    const controller = new AbortController();
    getCourses(request.filters, request.offset, controller.signal, (progress) => {
      setStatus(progress === "importing"
        ? "Importing classes from CUNY. Results will appear automatically."
        : "Another CUNY import is running. This search will retry automatically.");
    }).then((data) => {
      if (controller.signal.aborted) return;
      setStatus("");
      setResult(data);
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      setStatus("");
      setError(errorMessage(error));
    });
    return () => controller.abort();
  }, [request]);

  function search(filters: CourseFilters, offset = 0) {
    setError("");
    setStatus("Searching CUNY…");
    setResult(undefined);
    setRequest({ filters, offset });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    search({ term, college, q: query.trim(), subject, openOnly });
  }

  const offset = request?.offset ?? 0;

  return (
    <>
      <form className="catalog-filters" onSubmit={submit}>
        <label className="field">
          Search courses
          <input type="search" value={query} maxLength={120} placeholder="Course code, title, instructor, or class number"
            onChange={(event) => setQuery(event.target.value)} />
        </label>
        <div className="catalog-filter-row">
          <label className="field">
            Subject
            <select value={subject} onChange={(event) => setSubject(event.target.value)} disabled={Boolean(subjectStatus)}>
              <option value="">All subjects</option>
              {subjects.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
            </select>
          </label>
          <label className="check-field">
            <input type="checkbox" checked={openOnly} onChange={(event) => setOpenOnly(event.target.checked)} />
            Open sections only
          </label>
        </div>
        {subjectStatus && (
          <div className="catalog-status" role="status">
            {subjectStatus} {subjectStatus !== "Loading subjects…" && (
              <button className="text-button" type="button" onClick={() => {
                setSubjectStatus("Loading subjects…");
                setSubjectAttempt((attempt) => attempt + 1);
              }}>Retry subjects</button>
            )}
          </div>
        )}
        <button className="search-button" type="submit">{query.trim() ? "Search" : "Browse courses"}</button>
      </form>
      {status && <p className="catalog-status" role="status">{status}</p>}
      {error && request && (
        <p className="catalog-status" role="alert">
          {error} <button className="text-button" onClick={() => search(request.filters, offset)}>Retry search</button>
        </p>
      )}
      {result && request && (
        <>
          <p className="catalog-status" role="status">
            {result.total ? `Showing ${offset + 1}–${offset + result.courses.length} of ${result.total} courses` : "No courses match your search."}
          </p>
          <div className="course-list">
            {result.courses.map((course) => (
              <article className="course-card" key={JSON.stringify([course.subject, course.career, course.code])}>
                <div className="course-code">{course.code}</div>
                <h3>{course.title}</h3>
                {course.sections.map((section) => {
                  const entry = { term, college, code: course.code, title: course.title, subject: course.subject, section };
                  const id = sectionId(entry);
                  const selected = plan.some((saved) => sectionId(saved) === id);
                  const conflict = selected ? undefined : findConflict(entry, plan);
                  return (
                    <div className="section-row" key={id}>
                      <div className="section-heading">
                        <strong>{section.section} · #{section.classNumber}</strong>
                        <span>{section.status}</span>
                        <button
                          className={`add-button${selected ? " added" : ""}`}
                          type="button"
                          disabled={Boolean(conflict)}
                          aria-label={`${selected ? "Remove" : "Add"} ${course.code} section ${section.classNumber}`}
                          onClick={() => onToggle(entry)}
                        >{selected ? "Remove" : "Add"}</button>
                      </div>
                      <div className="section-details">{section.daysAndTimes || "Time TBA"}</div>
                      <div className="section-details">{[section.instructionMode, section.room, section.meetingDates].filter(Boolean).join(" · ")}</div>
                      {(section.instructor || "TBA").split("\n").map((name) =>
                        <Instructor key={name} name={name} college={college} />,
                      )}
                      {conflict && <div className="conflict-note">Time conflict with {conflict.code} #{conflict.section.classNumber}</div>}
                    </div>
                  );
                })}
              </article>
            ))}
          </div>
          {result.total > pageSize && (
            <nav className="pagination" aria-label="Course pages">
              <button type="button" disabled={offset === 0} onClick={() => search(request.filters, offset - pageSize)}>Previous</button>
              <button type="button" disabled={offset + pageSize >= result.total} onClick={() => search(request.filters, offset + pageSize)}>Next</button>
            </nav>
          )}
          <p className="catalog-footnote">CUNY snapshot from {new Date(result.fetchedAt).toLocaleString()}</p>
        </>
      )}
    </>
  );
}

function Instructor({ name, college }: { name: string; college: string }) {
  const [requested, setRequested] = useState(0);
  const [status, setStatus] = useState("");
  const [rating, setRating] = useState<Awaited<ReturnType<typeof getRating>>>();
  const namedInstructor = !/^(TBA|Staff|To be announced)$/i.test(name);

  useEffect(() => {
    if (!requested) return;
    const controller = new AbortController();
    getRating(name, college, controller.signal).then((data) => {
      if (controller.signal.aborted) return;
      setStatus("");
      setRating(data);
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setStatus(errorMessage(error));
    });
    return () => controller.abort();
  }, [name, college, requested]);

  return (
    <div className="section-details instructor">
      <span>{name}</span>
      {namedInstructor && rating === undefined && (
        <button className="text-button" type="button" disabled={status === "Loading rating…"} onClick={() => {
          setStatus("Loading rating…");
          setRequested((attempt) => attempt + 1);
        }}>Check rating</button>
      )}
      {status && <span role="status">{status}</span>}
      {rating === null && <span>No matching rating profile</span>}
      {rating && (
        <a href={`https://www.ratemyprofessors.com/professor/${rating.id}`} target="_blank" rel="noreferrer">
          {rating.overallRating === null ? "Rate My Professors · No ratings" :
            `Rate My Professors · ${rating.overallRating.toFixed(1)}/5 (${rating.ratingCount ?? 0})`}
        </a>
      )}
    </div>
  );
}
