import { findConflict, type PlannedSection } from "../planning.js";

export interface CourseChoice {
  code: string;
  classNumber: string | null;
}

export interface CourseRequirement {
  label: string;
  choices: CourseChoice[];
}

export interface Requirements {
  groups: CourseRequirement[];
  pending: string[];
  courseCount: number | null;
  scheduleName: string | null;
  career: "UGRD" | "GRAD" | "all";
  hasSectionPreferences: boolean;
}

export function courseKey(code: string) {
  return code.trim().toUpperCase().replace(/^([A-Z&/-]+)\s*\.?\s*(?=\d)/, "$1 ");
}

export function assignRequirements(groups: CourseRequirement[], candidates: PlannedSection[], limit = groups.length) {
  if (!groups.length) return new Map<number, PlannedSection>();
  const available = groups.map(({ choices }, index) => ({
    index,
    sections: choices.flatMap(({ code, classNumber }) => candidates.filter((entry) =>
      courseKey(entry.code) === courseKey(code) && (classNumber === null || classNumber === entry.section.classNumber),
    )),
  })).sort((a, b) => a.sections.length - b.sections.length);
  const possible = Math.min(limit, available.filter(({ sections }) => sections.length > 0).length);
  const chosen = new Map<number, PlannedSection>();
  const usedCourses = new Set<string>();
  let best = new Map<number, PlannedSection>();
  let steps = 0;

  function search(position: number) {
    if (chosen.size > best.size) best = new Map(chosen);
    if (best.size === possible || chosen.size + available.length - position <= best.size || ++steps > 10_000) return;
    const { index, sections } = available[position];
    for (const entry of sections) {
      const code = courseKey(entry.code);
      if (usedCourses.has(code) || findConflict(entry, [...chosen.values()])) continue;
      chosen.set(index, entry);
      usedCourses.add(code);
      search(position + 1);
      chosen.delete(index);
      usedCourses.delete(code);
      if (best.size === possible || steps > 10_000) return;
    }
    search(position + 1);
  }

  search(0);
  return best;
}

export function unmetRequirements(requirements: Requirements, sections: PlannedSection[]) {
  const { groups, pending, courseCount } = requirements;
  const assigned = assignRequirements(groups, sections);
  const missing = [...groups.filter((_, index) => !assigned.has(index)).map(({ label }) => label), ...pending];
  if (courseCount !== null && sections.length !== courseCount) {
    missing.push(`Requested ${courseCount} courses, found ${sections.length}.`);
  }
  return missing;
}
