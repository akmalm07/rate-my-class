import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { test } from "node:test";
import express from "express";
import { Sequelize } from "sequelize";
import { createAdvisorRouter } from "../src/advisor/router.js";
import type { RunModel } from "../src/advisor/model.js";
import { createCunyCatalog, createCunyRouter } from "../src/cuny/router.js";
import type { Course, Section } from "../src/cuny/scraper.js";

const testUrl = process.env.CUNY_TEST_DATABASE_URL;
test("advisor saves real conflict-free drafts and publishes only opted-in matching classes", { skip: !testUrl }, async () => {
  const schema = `advisor_test_${randomUUID().replaceAll("-", "")}`;
  const db = new Sequelize(testUrl!, { logging: false, define: { schema } });
  await db.createSchema(schema);
  const subjects = [{ id: "ENGL", name: "English" }];
  const longGoals = "I want to improve my writing. ".repeat(50).trim();
  const longRequirements = "One or two open English courses. ".repeat(50).trim();
  const section: Section = {
    classNumber: "10001", section: "LEC", status: "Open", daysAndTimes: "Mo 10:00AM - 11:00AM",
    room: "101", instructor: "Example", instructionMode: "In Person", meetingDates: "", topic: "",
  };
  const course: Course = {
    code: "ENGL. 1010", subject: "ENGL", subjectName: "English", displaySubject: "ENGL.",
    catalogNumber: "1010", title: "Writing I", career: "UGRD", sections: [section],
  };
  const catalog = createCunyCatalog(db, {
    scrapeSelections: async () => ({ terms: [{ id: "1272", name: "Spring" }], colleges: [{ id: "BKL01", name: "Brooklyn" }] }),
    scrapeSubjects: async () => subjects,
    scrapeSchedule: async (term, college) => ({ term, college, subjects, courses: [
      course,
      { ...course, code: "ENGL. 1020", catalogNumber: "1020", title: "Writing II",
        sections: [{ ...section, classNumber: "10002" }, { ...section, classNumber: "10003", daysAndTimes: "Tu 10:00AM - 11:00AM" }] },
      { ...course, code: "ENGL. 7001", catalogNumber: "7001", career: "GRAD", sections: [{ ...section, classNumber: "10004" }] },
    ] }),
  });

  function call(name: string, args: object) {
    return [{ type: "function_call" as const, call_id: randomUUID(), name, arguments: JSON.stringify(args) }];
  }
  const runModel: RunModel = async ({ input, tool_choice, tools }) => {
    const first = input[0];
    assert.ok("role" in first);
    if (tools[0].name === "record_interests") return call("record_interests", { interests: first.content.includes("biology") ? ["Biology"] : ["Writing"] });
    assert.equal(first.content, longGoals);
    assert.ok(input.some((item) => "role" in item && [longRequirements, "Alternative"].includes(item.content)));
    assert.equal(tool_choice, "required");
    const outputs = input.filter((item) => "type" in item && item.type === "function_call_output");
    if (!outputs.length) {
      assert.deepEqual(tools.map(({ name }) => name), ["search_catalog"]);
      return call("search_catalog", { q: "", subject: "ENGL", offset: 0, career: "UGRD" });
    }
    assert.ok(tools.some(({ name }) => name === "save_schedule"));
    if (outputs.length === 1) {
      assert.ok("output" in outputs[0] && !outputs[0].output.includes("10004"));
      return call("save_schedule", { name: "Invalid", classNumbers: ["99999"] });
    }
    if (outputs.length === 2) return call("save_schedule", { name: "Conflicting", classNumbers: ["10001", "10002"] });
    const latest = outputs.at(-1);
    assert.ok(latest && "output" in latest && latest.output.includes("no meeting overlaps"));
    const alternative = input.some((item) => "role" in item && item.content === "Alternative");
    return call("save_schedule", { name: "Writing plan", classNumbers: alternative ? ["10003"] : ["10001", "10003"], note: "Open sections." });
  };

  const app = express();
  app.use(express.json());
  app.use("/api/cuny", createCunyRouter(db, undefined, catalog));
  app.use("/api/advisor", createAdvisorRouter(db, catalog, runModel));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/api`;
  const params = "term=1272&college=BKL01";
  const send = (path: string, body: unknown, cookie = "", method = "POST") =>
    fetch(`${base}/advisor/${path}`, {
      method, body: JSON.stringify(body), headers: { Cookie: cookie, "Content-Type": "application/json" },
    });
  async function goals(goals: string) {
    const response = await send("goals", { goals });
    assert.equal(response.status, 200);
    assert.match((await response.json()).message, /What classes/);
    const cookie = response.headers.get("set-cookie")!;
    assert.match(cookie, /HttpOnly/);
    return cookie.split(";")[0];
  }
  async function matches(cookie: string, term = "1272") {
    const response = await fetch(`${base}/advisor/matches?term=${term}&college=BKL01`, { headers: { Cookie: cookie } });
    assert.equal(response.status, 200);
    return (await response.json()).classNumbers;
  }
  async function list(cookie: string) {
    return (await (await fetch(`${base}/advisor/schedules`, { headers: { Cookie: cookie } })).json()).schedules;
  }

  try {
    const imported = await fetch(`${base}/cuny/courses?${params}&subject=ENGL`);
    assert.ok([200, 202].includes(imported.status));
    const [owner, sameInterest, differentInterest] = await Promise.all([
      goals(longGoals),
      goals("I want to teach writing"),
      goals("I want to study biology"),
    ]);
    const body = {
      term: "1272", college: "BKL01", requestId: randomUUID(), goals: longGoals,
      messages: [{ role: "user", content: longRequirements }],
    };
    assert.equal((await send("message", body, `rmc_advisor=${"A".repeat(43)}`)).status, 409);
    const generated = await send("message", body, owner);
    assert.equal(generated.status, 200);
    const { schedule } = await generated.json();
    assert.deepEqual(schedule.sections.map(({ section }: { section: Section }) => section.classNumber), ["10001", "10003"]);
    assert.equal(schedule.committed, false);
    assert.deepEqual(schedule.interests, ["Writing"]);
    assert.equal((await (await send("message", body, owner)).json()).schedule.id, schedule.id);
    assert.equal((await list(owner)).length, 1);
    assert.deepEqual(await list(sameInterest), []);
    assert.deepEqual(await matches(sameInterest), []);
    assert.equal((await send(`schedules/${schedule.id}/commitment`, { committed: true }, sameInterest, "PUT")).status, 404);
    assert.equal((await send(`schedules/${schedule.id}/commitment`, { committed: true }, owner, "PUT")).status, 200);
    assert.deepEqual(await matches(sameInterest), ["10001", "10003"]);
    assert.deepEqual(await matches(owner), []);
    assert.deepEqual(await matches(differentInterest), []);
    assert.deepEqual(await matches(sameInterest, "1269"), []);

    const alternative = await (await send("message", { ...body, requestId: randomUUID(), messages: [{ role: "user", content: "Alternative" }] }, owner)).json();
    const replaced = await send(`schedules/${alternative.schedule.id}/commitment`, { committed: true }, owner, "PUT");
    assert.equal(replaced.status, 200);
    assert.deepEqual((await list(owner)).filter((entry: { committed: boolean }) => entry.committed).map((entry: { id: string }) => entry.id), [alternative.schedule.id]);
    assert.deepEqual(await matches(sameInterest), ["10003"]);
    assert.equal((await send(`schedules/${alternative.schedule.id}/commitment`, { committed: false }, owner, "PUT")).status, 200);
    assert.deepEqual(await matches(sameInterest), []);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.dropSchema(schema);
    await db.close();
  }
});
