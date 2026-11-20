import type { CourseSearchResponse, Option, Selections } from "../../backend/src/cuny/scraper";
import type { ProfessorSearchResponse } from "../../backend/src/professors/search";
import type { AdvisorMessage } from "../../backend/src/advisor/model";
import type { AdvisorSchedule } from "../../backend/src/advisor/store";

export type { AdvisorMessage, AdvisorSchedule };

export interface Catalog {
  term: string;
  college: string;
}

export interface CourseFilters extends Catalog {
  q: string;
  subject: string;
  openOnly: boolean;
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error ?? "The API is unavailable. Please try again.");
  }
  return response.json();
}

async function get<T>(path: string, signal: AbortSignal): Promise<T> {
  return readJson(await fetch(`/api/${path}`, { signal }));
}

export function getSelections(signal: AbortSignal) {
  return get<Selections>("cuny/selections", signal);
}

export function getSubjects({ term, college }: Catalog, signal: AbortSignal) {
  return get<Option[]>(`cuny/subjects?${new URLSearchParams({ term, college })}`, signal);
}

export const pageSize = 20;

export async function getCourses(
  { term, college, q, subject, openOnly }: CourseFilters,
  offset: number,
  signal: AbortSignal,
  onWait: (status: "importing" | "busy") => void = () => {},
): Promise<CourseSearchResponse> {
  const params = new URLSearchParams({ term, college, q, limit: String(pageSize), offset: String(offset) });
  if (subject) params.set("subject", subject);
  if (openOnly) params.set("openOnly", "true");

  while (true) {
    const response = await fetch(`/api/cuny/courses?${params}`, { signal });
    signal.throwIfAborted();
    const retryAfter = response.headers.get("Retry-After");
    if (response.status === 202 || (response.status === 503 && retryAfter !== null)) {
      const seconds = Number(retryAfter);
      onWait(response.status === 202 ? "importing" : "busy");
      await wait((seconds > 0 ? seconds : 5) * 1000, signal);
      continue;
    }
    return readJson(response);
  }
}

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    const timeout = window.setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    function abort() {
      window.clearTimeout(timeout);
      reject(signal.reason);
    }
    signal.addEventListener("abort", abort, { once: true });
  });
}

export async function getRating(name: string, college: string, signal: AbortSignal) {
  const params = new URLSearchParams({ q: name, college });
  const result = await get<ProfessorSearchResponse>(`professors/search?${params}`, signal);
  return result.professors[0] ?? null;
}

export function errorMessage(error: unknown) {
  return error instanceof Error && !(error instanceof TypeError) ? error.message : "Couldn't reach the API. Try again.";
}

async function send<T>(path: string, method: "POST" | "PUT", body: object): Promise<T> {
  return readJson(await fetch(`/api/advisor/${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

export function getAdvisorSchedules(signal: AbortSignal) {
  return get<{ schedules: AdvisorSchedule[] }>("advisor/schedules", signal);
}

export function sendAdvisorGoals(goals: string) {
  return send<{ message: string }>("goals", "POST", { goals });
}

export function sendAdvisorMessage(scope: Catalog, goals: string, messages: AdvisorMessage[], requestId: string) {
  return send<{ message: string; schedule?: AdvisorSchedule }>("message", "POST", { ...scope, goals, messages, requestId });
}

export function setAdvisorCommitment(id: string, committed: boolean) {
  return send<{ schedules: AdvisorSchedule[] }>(`schedules/${id}/commitment`, "PUT", { committed });
}

export async function getMatchingClasses({ term, college }: Catalog, signal: AbortSignal) {
  const { classNumbers } = await get<{ classNumbers: string[] }>(`advisor/matches?${new URLSearchParams({ term, college })}`, signal);
  return classNumbers;
}
