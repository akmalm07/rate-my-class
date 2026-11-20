import type { Course, Section } from "../../backend/src/cuny/scraper";
import { getCourses } from "./api";
import { sectionId, type PlannedSection } from "../../backend/src/planning";

export { findConflict, meetings, sectionId, weekdays, type PlannedSection } from "../../backend/src/planning";

const storageKey = "rate-my-class-schedule";
export const savedSchedulesKey = "rate-my-class-saved-schedules";
const classNumberPattern = /^\d+$/;

export interface SavedSchedule {
  name: string;
  term: string;
  sections: PlannedSection[];
}

export function loadSavedSchedules(): SavedSchedule[] {
  const saved: unknown = JSON.parse(localStorage.getItem(savedSchedulesKey) ?? "[]");
  if (!Array.isArray(saved)) throw new Error("Invalid saved schedules.");
  return saved.filter((item): item is SavedSchedule =>
    item !== null && typeof item === "object" && typeof item.name === "string" && Boolean(item.name.trim()) &&
    typeof item.term === "string" && Array.isArray(item.sections) && item.sections.length > 0 &&
    item.sections.every((section: unknown) => isPlannedSection(section) && section.term === item.term),
  );
}

export function saveSchedule(name: string, term: string, sections: PlannedSection[]): SavedSchedule[] {
  const saved = loadSavedSchedules();
  const names = new Set(saved.map((schedule) => schedule.name.toLowerCase()));
  let uniqueName = name;
  for (let count = 2; names.has(uniqueName.toLowerCase()); count++) {
    uniqueName = `${name} (${count})`;
  }
  const updated = [{ name: uniqueName, term, sections }, ...saved];
  localStorage.setItem(savedSchedulesKey, JSON.stringify(updated));
  return updated;
}

export function loadPlan(): { plan: PlannedSection[]; warning: string } {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
    if (Array.isArray(saved) && saved.every(isPlannedSection)) return { plan: saved, warning: "" };
  } catch {
    // The browser can deny access to local storage.
  }
  return { plan: [], warning: "The saved schedule could not be restored." };
}

function isPlannedSection(value: unknown): value is PlannedSection {
  if (!value || typeof value !== "object") return false;
  const entry = value as PlannedSection;
  return [entry.term, entry.college, entry.subject, entry.code, entry.title].every((field) => typeof field === "string") &&
    entry.section != null && ["classNumber", "section", "daysAndTimes", "meetingDates"]
      .every((field) => typeof entry.section[field as keyof Section] === "string") &&
    classNumberPattern.test(entry.section.classNumber);
}

export function savePlan(plan: PlannedSection[]) {
  localStorage.setItem(storageKey, JSON.stringify(plan));
}

export function createPlanLink(plan: PlannedSection[], term: string) {
  const url = new URL(window.location.href);
  url.searchParams.set("term", term);
  url.searchParams.set("plan", JSON.stringify(plan.map(({ term, college, subject, code, section }) =>
    [term, college, subject, code, section.classNumber],
  )));
  return url.toString();
}

export async function getSharedPlan(value: string, signal: AbortSignal): Promise<PlannedSection[]> {
  const refs: unknown = JSON.parse(value);
  if (!Array.isArray(refs) || !refs.every((ref) =>
    Array.isArray(ref) && ref.length === 5 && ref.every((part) => typeof part === "string") &&
    classNumberPattern.test(ref[4]),
  )) throw new Error("This plan link is invalid.");

  const requests = new Map<string, Promise<{ courses: Course[] }>>();
  const plan = await Promise.all(refs.map(async ([term, college, subject, code, classNumber]: string[]) => {
    const key = JSON.stringify([term, college, subject, code]);
    let pending = requests.get(key);
    if (!pending) {
      pending = getCourses({ term, college, subject, q: code, openOnly: false }, 0, signal);
      requests.set(key, pending);
    }
    const { courses } = await pending;
    for (const course of courses) {
      const section = course.sections.find((candidate) => candidate.classNumber === classNumber);
      if (section) return { term, college, subject, code: course.code, title: course.title, section };
    }
    throw new Error(`Class #${classNumber} is unavailable in the shared plan.`);
  }));
  return [...new Map(plan.map((entry) => [sectionId(entry), entry])).values()];
}

export function formatTime(time: number) {
  const hour = Math.floor(time / 60);
  return `${hour % 12 || 12}:${String(time % 60).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}`;
}
