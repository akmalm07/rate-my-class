import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import { test } from "node:test";
import express from "express";
import { chromium } from "playwright";
import { Sequelize } from "sequelize";
import { createCunyRouter } from "../src/cuny/router.js";
import { readResults, type Course } from "../src/cuny/scraper.js";

test("preserves catalog suffixes and parses hidden section rows, including closed sections", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const subject = { id: "ENGL", name: "English" };
    await page.setContent(`
      <p>1 class section(s) found</p>
      <span><a id="imageDivLink0" aria-label="Class Section Sub"></a>
        ENGL.&nbsp;0101.1W&nbsp;-&nbsp;Writing - Seminar
      </span>
      <div id="contentDivImg0" hidden><table class="classinfo"><tbody><tr>
        <td data-label="Class"><a>01314</a></td>
        <td data-label="Section">H1-LEC Regular</td>
        <td data-label="Instructor">Ada Example<br>Ada Example<br>Grace Example</td>
        <td data-label="Status"><img title="Closed" alt="Open"></td>
      </tr></tbody></table></div>
    `);
    const [course] = await readResults(page, subject, "UGRD");
    assert.equal(course.code, "ENGL. 0101.1W");
    assert.equal(course.catalogNumber, "0101.1W");
    assert.equal(course.displaySubject, "ENGL.");
    assert.equal(course.title, "Writing - Seminar");
    assert.equal(course.sections[0].classNumber, "01314");
    assert.equal(course.sections[0].status, "Closed");
    assert.equal(course.sections[0].instructor, "Ada Example\nGrace Example");
    const [alias] = await readResults(page, { id: "MESG", name: "Example filter" }, "GRAD");
    assert.equal(alias.subject, "MESG");
    assert.equal(alias.displaySubject, "ENGL.");

    await page.locator("p").evaluate((element) => { element.textContent = "2 class section(s) found"; });
    await assert.rejects(readResults(page, subject, "UGRD"), /truncated/);
    await page.setContent("The search returns no results that match the criteria specified.");
    assert.deepEqual(await readResults(page, subject, "UGRD"), []);
    await page.setContent("An error occurred. Start over.");
    await assert.rejects(readResults(page, subject, "UGRD"), /Unexpected/);
  } finally {
    await browser.close();
  }
});

async function listen(servers: Server[], router: ReturnType<typeof createCunyRouter>) {
  const app = express();
  app.use("/api/cuny", router);
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}/api/cuny`;
}

const testUrl = process.env.CUNY_TEST_DATABASE_URL;
test("persists and searches a college and term snapshot across API instances", { skip: !testUrl }, async () => {
  const schema = `cuny_test_${randomUUID().replaceAll("-", "")}`;
  const db = new Sequelize(testUrl!, { logging: false, define: { schema } });
  const servers: Server[] = [];
  await db.createSchema(schema);
  const course: Course = {
    code: "ENGL. 1010", subject: "ENGL", subjectName: "English", displaySubject: "ENGL.", catalogNumber: "1010",
    title: "English Composition I", career: "UGRD",
    sections: [{
      classNumber: "39019", section: "MW11-LEC Regular", daysAndTimes: "MoWe 11:00AM - 12:15PM",
      room: "TBA", instructor: "Ada Example", instructionMode: "In Person", meetingDates: "TBA",
      status: "Closed", topic: "",
    }],
  };
  let selectionsCalls = 0;
  let subjectsCalls = 0;
  let scheduleCalls = 0;
  const subjectCalls: string[] = [];
  let finish!: () => void;
  const importGate = new Promise<void>((resolve) => { finish = resolve; });
  const source = {
    scrapeSubjects: async () => {
      subjectsCalls++;
      return [{ id: "ENGL", name: "English" }];
    },
    scrapeSelections: async () => {
      selectionsCalls++;
      return {
        terms: [{ id: "1272", name: "2027 Spring Term" }, { id: "1269", name: "2026 Fall Term" }],
        colleges: [{ id: "BKL01", name: "Brooklyn College" }, { id: "QCC01", name: "Queensborough CC" }],
      };
    },
    scrapeSchedule: async (term: string, college: string, subject?: string) => {
      if (subject) {
        subjectCalls.push(subject);
        return { term, college, subjects: [{ id: subject, name: "English" }], courses: [
          course, {
            ...course, code: "ENGL. 1010W", catalogNumber: "1010W",
            sections: [...course.sections, { ...course.sections[0], classNumber: "39020", status: "Open", instructor: "Grace Example" }],
          },
        ] };
      }
      scheduleCalls++;
      if (college === "QCC01") throw new Error("Test upstream failure");
      await importGate;
      return { term, college, subjects: [{ id: "ENGL", name: "English" }], courses: term === "1272" ? [course] : [] };
    },
  };
  try {
    const url = await listen(servers, createCunyRouter(db, source));
    const params = "term=1272&college=BKL01";
    const invalid = await fetch(`${url}/courses?term=1272&college=FAKE`);
    assert.equal(invalid.status, 400);
    assert.equal((await fetch(`${url}/selections`)).status, 200);
    assert.equal(selectionsCalls, 1);
    const subjectLists = await Promise.all(Array.from({ length: 3 }, async () =>
      (await fetch(`${url}/subjects?${params}`)).json(),
    ));
    assert.ok(subjectLists.every((list) => list[0]?.id === "ENGL"));
    assert.equal(subjectsCalls, 1);
    const concurrent = await Promise.all(
      Array.from({ length: 3 }, () => fetch(`${url}/courses?${params}`)),
    );
    assert.ok(concurrent.every((result) => result.status === 202));
    assert.equal(scheduleCalls, 1);
    assert.equal((await fetch(`${url}/courses?term=1269&college=BKL01`)).status, 503);
    finish();

    async function waitForCache(base: string, query: string) {
      for (let attempt = 0; attempt < 40; attempt++) {
        const response = await fetch(`${base}/courses?${query}`);
        if (response.status === 200) return response.json();
        assert.equal(response.status, 202);
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error("Timed out waiting for cached schedule");
    }
    assert.equal((await waitForCache(url, params)).total, 1);
    assert.equal((await waitForCache(url, "term=1269&college=BKL01")).total, 0);
    const reopened = await listen(servers, createCunyRouter(db, source));
    assert.deepEqual(await (await fetch(`${reopened}/subjects?${params}`)).json(), subjectLists[0]);
    assert.equal(subjectsCalls, 1);
    for (const query of ["engl1010", "ENGL 1010", "composition", "Ada Example", "39019"]) {
      const response = await fetch(`${reopened}/courses?${params}&q=${encodeURIComponent(query)}`);
      assert.equal(response.status, 200);
      assert.deepEqual((await response.json()).courses, [course]);
    }
    const miss = await fetch(`${reopened}/courses?${params}&q=nonexistent`);
    assert.equal((await miss.json()).total, 0);
    const paged = await fetch(`${reopened}/courses?${params}&limit=1&offset=1`);
    assert.deepEqual((await paged.json()).courses, []);
    assert.equal((await fetch(`${reopened}/courses?term=1269&college=BKL01`)).status, 200);
    assert.equal(scheduleCalls, 2);
    assert.equal(selectionsCalls, 1);
    assert.equal((await (await fetch(`${reopened}/courses?${params}&subject=ENGL&q=composition`)).json()).total, 1);
    assert.equal((await (await fetch(`${reopened}/courses?${params}&subject=MATH`)).json()).total, 0);
    assert.equal((await (await fetch(`${reopened}/courses?${params}&openOnly=true`)).json()).total, 0);
    assert.equal((await fetch(`${reopened}/courses?${params}&openOnly=maybe`)).status, 400);
    const targeted = "term=1272&college=QCC01&q=ENGL1010";
    assert.equal((await fetch(`${reopened}/courses?${targeted}`)).status, 202);
    assert.deepEqual((await waitForCache(reopened, targeted)).courses, [course]);
    const sameSubject = await fetch(`${reopened}/courses?${targeted}W`);
    assert.equal((await sameSubject.json()).courses[0].code, "ENGL. 1010W");
    assert.deepEqual(subjectCalls, ["ENGL"]);
    const browseSubject = await fetch(`${reopened}/courses?term=1272&college=QCC01&subject=ENGL`);
    assert.equal((await browseSubject.json()).total, 2);
    const filtered = await fetch(`${reopened}/courses?term=1272&college=QCC01&subject=ENGL&openOnly=true&limit=1`);
    const filteredPage = await filtered.json();
    assert.equal(filteredPage.total, 1);
    assert.equal(filteredPage.courses[0].code, "ENGL. 1010W");
    assert.deepEqual(filteredPage.courses[0].sections.map(({ classNumber }: { classNumber: string }) => classNumber), ["39020"]);
    const instructor = await fetch(`${reopened}/courses?term=1272&college=QCC01&subject=ENGL&q=Grace+Example`);
    assert.deepEqual((await instructor.json()).courses[0].sections, filteredPage.courses[0].sections);
    assert.equal(scheduleCalls, 2);
    const failure = `${reopened}/courses?term=1272&college=QCC01`;
    assert.equal((await fetch(failure)).status, 202);
    const retry = await fetch(failure);
    assert.equal(retry.status, 502);
    assert.equal(retry.headers.get("retry-after"), "60");
    assert.equal(scheduleCalls, 3);
  } finally {
    finish();
    await Promise.all(servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
    await db.dropSchema(schema);
    await db.close();
  }
});
