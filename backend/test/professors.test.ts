import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import express from "express";
import { DEFAULT_BASE_URL } from "ratemyprofessors-client";
import { professorRouter } from "../src/professors/router.js";

test("searches professors through the SDK and returns a paginated JSON response", async (t) => {
  const upstreamRequests: unknown[] = [];
  const fetchLocal = globalThis.fetch;
  const cursor = "YXJyYXljb25uZWN0aW9uOjA=";
  t.mock.method(globalThis, "fetch", async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    if (input !== DEFAULT_BASE_URL) return fetchLocal(input, init);

    assert.equal(init?.method, "POST");
    const body = init?.body;
    assert.ok(typeof body === "string");
    const { operationName, variables } = JSON.parse(body);
    assert.equal(operationName, "TeacherSearchResultsPageQuery");
    upstreamRequests.push(variables);
    if (variables.query.text === "Upstream failure") {
      return Response.json({ errors: [{ message: "Upstream details" }] });
    }

    const hasMatch = variables.query.text !== "No match";
    const secondPage = variables.cursor === cursor;
    return Response.json({
      data: {
        search: {
          teachers: {
            resultCount: hasMatch ? 2 : 0,
            pageInfo: { hasNextPage: hasMatch && !secondPage, endCursor: hasMatch ? cursor : null },
            edges: hasMatch ? [{
              node: {
                legacyId: secondPage ? 43 : 42,
                firstName: "Ada",
                lastName: "Example",
                department: "English",
                school: { legacyId: 223, name: "Brooklyn College" },
                avgRating: secondPage ? 0 : 4.5,
                numRatings: secondPage ? 0 : 12,
                avgDifficulty: secondPage ? 0 : 2.5,
                wouldTakeAgainPercent: secondPage ? -1 : 0,
              },
            }] : [],
          },
        },
      },
    });
  });

  const app = express();
  app.use("/api/professors", professorRouter);
  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/api/professors/search`;

  for (const query of ["", "?q=%20", "?q=Ada&q=Example", "?q=Ada&schoolId=BKL01", "?q=Ada&limit=51", "?q=Ada&cursor="]) {
    assert.equal((await fetch(`${url}${query}`)).status, 400, query);
  }
  assert.deepEqual(upstreamRequests, []);

  const first = await fetch(`${url}?q=%20Ada%20Example%20&schoolId=223&limit=1`);
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), {
    total: 2,
    nextCursor: cursor,
    professors: [{
      id: "42", name: "Ada Example", department: "English", school: { id: "223", name: "Brooklyn College" },
      overallRating: 4.5, ratingCount: 12, difficulty: 2.5, wouldTakeAgainPercent: 0,
    }],
  });
  const query = new URLSearchParams({ q: "Ada Example", schoolId: "223", limit: "1", cursor });
  const second = await fetch(`${url}?${query}`);
  assert.equal(second.status, 200);
  assert.deepEqual(await second.json(), {
    total: 2,
    nextCursor: null,
    professors: [{
      id: "43", name: "Ada Example", department: "English", school: { id: "223", name: "Brooklyn College" },
      overallRating: null, ratingCount: 0, difficulty: null, wouldTakeAgainPercent: null,
    }],
  });

  const empty = await fetch(`${url}?q=No+match`);
  assert.equal(empty.status, 200);
  assert.deepEqual(await empty.json(), { total: 0, nextCursor: null, professors: [] });

  const error = await fetch(`${url}?q=Upstream+failure`);
  assert.equal(error.status, 502);
  assert.deepEqual(await error.json(), { error: "Rate My Professors search is currently unavailable." });

  const schoolID = Buffer.from("School-223").toString("base64");
  assert.deepEqual(upstreamRequests, [
    { query: { text: "Ada Example", schoolID }, count: 1, cursor: "" },
    { query: { text: "Ada Example", schoolID }, count: 1, cursor },
    { query: { text: "No match" }, count: 20, cursor: "" },
    { query: { text: "Upstream failure" }, count: 20, cursor: "" },
  ]);
});
