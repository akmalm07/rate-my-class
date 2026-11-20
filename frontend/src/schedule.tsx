import { useState } from "react";
import type { Option } from "../../backend/src/cuny/scraper";
import type { AdvisorSchedule } from "./api";
import { formatTime, meetings, sectionId, weekdays, type PlannedSection, type SavedSchedule } from "./plan";

const hourHeight = 48;
const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

interface ScheduleProps {
  plan: PlannedSection[];
  colleges: Option[];
  terms: Option[];
  loading: boolean;
  savedSchedules: SavedSchedule[];
  advisorSchedules: AdvisorSchedule[];
  advisorError: string;
  commitPending: boolean;
  onSave: (name: string) => boolean;
  onOpen: (schedule: SavedSchedule) => void;
  onCommit: (schedule: AdvisorSchedule) => void;
  onRemove: (entry: PlannedSection) => void;
  onClear: () => void;
}

export function Schedule({
  plan, colleges, terms, loading, savedSchedules, advisorSchedules, advisorError, commitPending,
  onSave, onOpen, onCommit, onRemove, onClear,
}: ScheduleProps) {
  const [name, setName] = useState("");
  const events = plan.flatMap((entry) => meetings(entry.section).map((meeting, index) => ({ entry, meeting, index })));
  const start = Math.min(8, ...events.map(({ meeting }) => Math.floor(meeting.start / 60)));
  const end = Math.max(20, ...events.map(({ meeting }) => Math.ceil(meeting.end / 60)));
  const hours = Array.from({ length: end - start }, (_, index) => start + index);
  const schedules = [
    ...advisorSchedules.map((advisor) => ({ schedule: advisor, advisor })),
    ...savedSchedules.map((schedule) => ({ schedule, advisor: undefined })),
  ];

  return (
    <section className="schedule-panel" id="planner" aria-labelledby="schedule-heading">
      <div className="schedule-header">
        <h2 id="schedule-heading">My schedule</h2>
        {plan.length > 0 && !loading && <button className="text-button" onClick={onClear}>Clear all</button>}
      </div>
      <section className="saved-schedules" aria-labelledby="saved-heading">
        <h3 id="saved-heading">Saved schedules</h3>
        {plan.length > 0 && !loading && (
          <form className="save-schedule-form" onSubmit={(event) => {
            event.preventDefault();
            if (onSave(name)) setName("");
          }}>
            <label className="field">
              Schedule name
              <input value={name} maxLength={80} placeholder="Optional" onChange={(event) => setName(event.target.value)} />
            </label>
            <button className="share-button" type="submit">Save schedule</button>
          </form>
        )}
        {schedules.length > 0 && (
          <>
            <ul className="saved-schedule-list">
              {schedules.map(({ schedule, advisor }) => (
                <li key={advisor?.id ?? schedule.name}>
                  <button className="saved-schedule" type="button" disabled={loading}
                    onClick={() => onOpen(schedule)}>
                    <strong>{schedule.name}</strong>
                    <span>{terms.find(({ id }) => id === schedule.term)?.name ?? `Term ${schedule.term}`} · {schedule.sections.length} {schedule.sections.length === 1 ? "section" : "sections"}</span>
                  </button>
                  {advisor && (
                    <div className="commitment">
                      <span>{advisor.committed ? "Committed" : "Advisor draft"}{Boolean(advisor.interests.length) &&
                        ` · ${advisor.interests.join(", ")}`}</span>
                      <button className="text-button" type="button" disabled={commitPending} onClick={() => onCommit(advisor)}>
                        {advisor.committed ? "Withdraw commitment" : "Commit schedule"}
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            <p className="saved-schedule-hint">Opening a saved schedule replaces the draft for that term.</p>
            {advisorSchedules.length > 0 && <p className="saved-schedule-hint">
              Committing shares an anonymous interest match for these sections and replaces any previous commitment for the term.
            </p>}
          </>
        )}
        {!schedules.length && !plan.length && <p className="saved-schedule-hint">Add a section to save your first schedule.</p>}
        {advisorError && <p className="advisor-error" role="alert">{advisorError}</p>}
      </section>
      {loading ? <p className="catalog-status" role="status">Restoring shared schedule…</p> : (
        <>
          <p className="schedule-summary">{plan.length} {plan.length === 1 ? "section" : "sections"} in this term</p>
          <div className="calendar-scroll" aria-label="Weekly schedule">
            <div className="calendar">
              <div className="calendar-head">
                <div />
                {dayNames.map((day) => <div className="day-heading" key={day}>{day}</div>)}
              </div>
              <div className="calendar-body">
                <div>
                  {hours.map((hour) => (
                    <div className="time-label" style={{ height: hourHeight }} key={hour}>{formatTime(hour * 60)}</div>
                  ))}
                </div>
                <div className="day-columns">
                  {weekdays.map((day) => (
                    <div className="day-column" key={day}>
                      {hours.map((hour) => <div className="hour-cell" style={{ height: hourHeight }} key={hour} />)}
                      {events.filter(({ meeting }) => meeting.days.includes(day)).map(({ entry, meeting, index }) => (
                        <div className="calendar-event" key={`${sectionId(entry)}:${index}`}
                          style={{
                            top: (meeting.start / 60 - start) * hourHeight,
                            height: (meeting.end - meeting.start) / 60 * hourHeight,
                          }}
                          title={`${entry.code} #${entry.section.classNumber} · ${entry.section.meetingDates}`}
                        >
                          <strong>{entry.code}</strong>
                          <span>{formatTime(meeting.start)}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
                {events.length === 0 && (
                  <div className="calendar-empty">{plan.length ? "No set meeting times." : "Add a section to build your schedule."}</div>
                )}
              </div>
            </div>
          </div>
          {plan.length > 0 && (
            <ul className="saved-sections">
              {plan.map((entry) => (
                <li key={sectionId(entry)}>
                  <div>
                    <strong>{entry.code} · #{entry.section.classNumber}</strong>
                    <div>{colleges.find(({ id }) => id === entry.college)?.name ?? entry.college}</div>
                    <div>{entry.section.daysAndTimes || "Time TBA"} · {entry.section.meetingDates || "Dates TBA"}</div>
                  </div>
                  <button className="text-button" onClick={() => onRemove(entry)}
                    aria-label={`Remove saved section ${entry.section.classNumber}`}>Remove</button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
