import type { Section } from "./cuny/scraper.js";

export interface PlannedSection {
  term: string;
  college: string;
  subject: string;
  code: string;
  title: string;
  section: Section;
}

export const weekdays = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

export function sectionId({ college, term, section }: PlannedSection) {
  return `${term}:${college}:${section.classNumber}`;
}

interface Meeting {
  days: string[];
  start: number;
  end: number;
  dates: [number, number] | undefined;
}

function minutes(hour: string, minute: string, suffix: string) {
  return ((Number(hour) % 12) + (suffix.toUpperCase() === "PM" ? 12 : 0)) * 60 + Number(minute);
}

export function meetings(section: Pick<Section, "daysAndTimes" | "meetingDates">): Meeting[] {
  const timePattern = /((?:Mo|Tu|We|Th|Fr|Sa|Su)+)\s+(\d{1,2}):(\d\d)\s*(AM|PM)\s*[-–]\s*(\d{1,2}):(\d\d)\s*(AM|PM)/gi;
  const times = [...section.daysAndTimes.matchAll(timePattern)];
  const dates = [...section.meetingDates.matchAll(/(\d{1,2}\/\d{1,2}\/\d{4})\s*-\s*(\d{1,2}\/\d{1,2}\/\d{4})/g)]
    .map(([, start, end]): [number, number] => [Date.parse(start), Date.parse(end)]);
  const unique = new Map<string, Meeting>();
  times.forEach(([, days, startHour, startMinute, startSuffix, endHour, endMinute, endSuffix], index) => {
    const start = minutes(startHour, startMinute, startSuffix);
    const end = minutes(endHour, endMinute, endSuffix);
    if (end <= start) return;
    const meeting = {
      days: weekdays.filter((day) => days.toLowerCase().includes(day.toLowerCase())),
      start, end,
      dates: dates.length === 1 ? dates[0] : dates.length === times.length ? dates[index] : undefined,
    };
    unique.set(JSON.stringify(meeting), meeting);
  });
  return [...unique.values()];
}

export function findConflict(entry: PlannedSection, plan: PlannedSection[]) {
  const candidate = meetings(entry.section);
  return plan.find((other) => other.term === entry.term && sectionId(other) !== sectionId(entry) &&
    meetings(other.section).some((a) => candidate.some((b) =>
      a.start < b.end && b.start < a.end &&
      a.days.some((day) => b.days.includes(day)) &&
      (!a.dates || !b.dates || (a.dates[0] <= b.dates[1] && b.dates[0] <= a.dates[1])),
    )),
  );
}
