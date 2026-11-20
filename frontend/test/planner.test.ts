import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium } from "playwright";
import { createServer } from "vite";
import type { Course, Section } from "../../backend/src/cuny/scraper";
import { findConflict, meetings, type PlannedSection } from "../src/plan";

const section: Section = {
  classNumber: "99001", section: "A1-LEC", instructor: "Ada Example", status: "Open",
  instructionMode: "In Person", room: "Example Hall", topic: "",
  daysAndTimes: "Mo 10:00AM - 11:00AMSa 12:00PM - 1:00PM", meetingDates: "02/01/2027 - 05/15/2027",
};
const course: Course = {
  code: "ENGL. 1010", subject: "ENGL", displaySubject: "ENGL.", subjectName: "English",
  catalogNumber: "1010", career: "UGRD", title: "English Composition I",
  sections: [
    section,
    { ...section, classNumber: "99002", instructor: "TBA", daysAndTimes: "Sa 12:15PM - 1:00PM" },
    { ...section, classNumber: "99003", instructor: "TBA", status: "Closed" },
  ],
};
const term = "1272";
const college = "BKL01";

test("parses multiple meetings from cached CUNY rows and checks times, dates, and terms", () => {
  assert.deepEqual(meetings(section).map(({ days, start, end }) => ({ days, start, end })), [
    { days: ["Mo"], start: 600, end: 660 }, { days: ["Sa"], start: 720, end: 780 },
  ]);
  assert.deepEqual(meetings({ daysAndTimes: "TBA", meetingDates: "" }), []);
  assert.equal(meetings({ ...section, daysAndTimes: "Mo 10:00AM - 11:00AM Mo 10:00AM - 11:00AM" }).length, 1);
  const entry: PlannedSection = { term, college, code: course.code, title: course.title, subject: "ENGL", section };
  const sameTime = { ...entry, section: course.sections[1] };
  assert.equal(findConflict(sameTime, [entry]), entry);
  assert.equal(findConflict({ ...sameTime, term: "1269" }, [entry]), undefined);
  assert.equal(findConflict({ ...sameTime, section: { ...sameTime.section, meetingDates: "01/04/2027 - 01/23/2027" } }, [entry]), undefined);
  assert.equal(findConflict({ ...sameTime, section: { ...sameTime.section, daysAndTimes: "Sa 1:00PM - 2:00PM" } }, [entry]), undefined);
});

test("planner browser flow handles filters, polling, failures, ratings, and saved and shared schedules", { timeout: 45_000 }, async (t) => {
  const server = await createServer({ server: { host: "127.0.0.1", port: 0 } });
  t.after(() => server.close());
  await server.listen();
  const url = server.resolvedUrls!.local[0];
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const context = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
  context.setDefaultTimeout(8_000);
  const errors: Error[] = [];
  const requests: URLSearchParams[] = [];
  const ratingRequests: URLSearchParams[] = [];
  let selectionsAvailable = false;
  let failure = true;
  let firstFilteredPage = 0;
  await context.route("**/api/**", async (route) => {
    const { pathname, searchParams } = new URL(route.request().url());
    if (pathname === "/api/advisor/schedules") return route.fulfill({ json: { schedules: [] } });
    if (pathname === "/api/advisor/matches") return route.fulfill({ json: { classNumbers: [] } });
    if (pathname.endsWith("/selections")) {
      if (!selectionsAvailable) return route.fulfill({ status: 503, json: { error: "Catalog unavailable." } });
      return route.fulfill({ json: {
        terms: [{ id: term, name: "2027 Spring Term" }, { id: "1269", name: "2026 Fall Term" }],
        colleges: [{ id: college, name: "Brooklyn College" }, { id: "QCC01", name: "Queensborough CC" }],
      } });
    }
    if (pathname.endsWith("/subjects")) {
      return route.fulfill({ json: searchParams.get("college") === college
        ? [{ id: "ENGL", name: "English" }] : [{ id: "MATH", name: "Mathematics" }] });
    }
    if (pathname.endsWith("/search")) {
      ratingRequests.push(searchParams);
      return route.fulfill({ json: { total: 1, nextCursor: null, professors: [
        { id: "42", name: "Ada Example", overallRating: 4.5, ratingCount: 12 },
      ] } });
    }

    requests.push(searchParams);
    const q = searchParams.get("q");
    const open = searchParams.get("openOnly") === "true";
    const offset = Number(searchParams.get("offset"));
    if (q === "retry" && failure) {
      failure = false;
      return route.fulfill({ status: 502, json: { error: "CUNY import failed." } });
    }
    if (q === "pending") {
      return route.fulfill({ status: 202, headers: { "Retry-After": "1" }, json: { status: "importing" } });
    }
    if (q === "ENGL1010" && open && offset === 0 && ++firstFilteredPage <= 2) {
      return route.fulfill({
        status: firstFilteredPage === 1 ? 503 : 202,
        headers: { "Retry-After": "1" },
        json: { status: "importing" },
      });
    }
    const listedCourse = {
      ...course,
      sections: open ? course.sections.filter(({ status }) => status === "Open") : course.sections,
    };
    const courses = q === "retry" ? [] : [listedCourse];
    return route.fulfill({ json: {
      term, college, courses, fetchedAt: "2026-11-20T12:00:00Z", subjects: [],
      total: !courses.length ? 0 : open ? 21 : 1,
    } });
  });

  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error));
  await page.goto(url);
  await page.getByRole("alert").filter({ hasText: "Catalog unavailable." }).waitFor();
  selectionsAvailable = true;
  await page.getByRole("button", { name: "Retry catalog" }).click();
  await page.getByRole("combobox", { name: "Term", exact: true }).selectOption(term);
  await page.getByRole("combobox", { name: "College", exact: true }).selectOption(college);
  await page.getByRole("combobox", { name: "Subject", exact: true }).selectOption("ENGL");
  assert.equal(requests.length, 0);

  const query = page.getByRole("searchbox");
  await query.fill("ENGL1010");
  await page.getByLabel("Open sections only").check();
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByText("Another CUNY import is running", { exact: false }).waitFor();
  await page.getByText("Importing classes from CUNY", { exact: false }).waitFor();
  await page.getByRole("heading", { name: course.title }).waitFor();
  assert.deepEqual(Object.fromEntries(requests[0]), {
    term, college, q: "ENGL1010", subject: "ENGL", openOnly: "true", limit: "20", offset: "0",
  });
  assert.equal(await page.getByText("#99003", { exact: false }).count(), 0);
  assert.equal(ratingRequests.length, 0);
  await page.getByRole("button", { name: "Check rating" }).click();
  await page.getByRole("link", { name: "Rate My Professors · 4.5/5 (12)" }).waitFor();
  assert.deepEqual(Object.fromEntries(ratingRequests[0]), { q: "Ada Example", college });

  await page.getByRole("button", { name: "Add ENGL. 1010 section 99001" }).click();
  await page.locator(".calendar-event").first().waitFor();
  assert.equal(await page.locator(".calendar-event").count(), 2);
  assert.equal(await page.getByRole("button", { name: "Add ENGL. 1010 section 99002" }).isDisabled(), true);
  await page.getByRole("textbox", { name: "Schedule name" }).fill("First choice");
  await page.getByRole("button", { name: "Save schedule", exact: true }).click();
  await page.getByRole("button", { name: /First choice/ }).waitFor();
  await page.getByRole("button", { name: "Remove ENGL. 1010 section 99001" }).click();
  await page.getByRole("button", { name: "Add ENGL. 1010 section 99002" }).click();
  await page.getByRole("textbox", { name: "Schedule name" }).fill("First choice");
  await page.getByRole("button", { name: "Save schedule", exact: true }).click();
  await page.getByRole("button", { name: /First choice \(2\)/ }).waitFor();
  await page.getByRole("button", { name: /^First choice 2027/ }).click();
  await page.getByRole("button", { name: "Remove saved section 99001" }).waitFor();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByText("Showing 21–21 of 21 courses").waitFor();
  assert.equal(requests.at(-1)?.get("offset"), "20");
  await page.getByRole("button", { name: "Previous" }).click();
  await page.getByText("Showing 1–1 of 21 courses").waitFor();

  await query.fill("retry");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "CUNY import failed." }).waitFor();
  await page.getByRole("button", { name: "Retry search" }).click();
  await page.getByText("No courses match your search.").waitFor();
  await query.fill("pending");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByText("Importing classes from CUNY", { exact: false }).waitFor();
  await page.getByRole("combobox", { name: "College", exact: true }).selectOption("QCC01");
  await page.getByRole("combobox", { name: "Subject", exact: true }).selectOption("MATH");
  assert.equal(await query.inputValue(), "");
  await page.getByRole("button", { name: "Browse courses" }).click();
  await page.getByRole("heading", { name: course.title }).waitFor();
  assert.equal(requests.at(-1)?.get("college"), "QCC01");
  assert.equal(requests.at(-1)?.get("subject"), "MATH");
  await assert.rejects(page.waitForRequest((request) => request.url().includes("q=pending"), { timeout: 1200 }),
    { name: "TimeoutError" });

  await page.reload();
  await page.getByRole("button", { name: "Remove saved section 99001" }).waitFor();
  await page.getByRole("button", { name: "Clear all" }).click();
  await page.reload();
  await page.getByText("0 sections in this term").waitFor();
  await page.getByRole("button", { name: /First choice \(2\)/ }).click();
  await page.getByRole("button", { name: "Remove saved section 99002" }).waitFor();
  await page.getByRole("button", { name: /^First choice 2027/ }).click();
  await page.getByRole("button", { name: "Remove saved section 99001" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Remove saved section 99002" }).count(), 0);
  await page.getByRole("button", { name: "Share plan" }).click();
  await page.getByText("Schedule link copied.").waitFor();
  const sharedUrl = await page.evaluate(() => navigator.clipboard.readText());
  const recipient = await context.newPage();
  await recipient.goto(sharedUrl);
  await recipient.getByRole("button", { name: "Remove saved section 99001" }).waitFor();
  assert.equal(requests.at(-1)?.get("q"), "ENGL. 1010");
  await recipient.getByRole("button", { name: "Remove saved section 99001" }).click();
  await recipient.getByText("0 sections in this term").waitFor();
  assert.deepEqual(errors, []);
});
