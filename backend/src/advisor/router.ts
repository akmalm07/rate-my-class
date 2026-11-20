import { createHash, randomBytes } from "node:crypto";
import { Router, type ErrorRequestHandler, type Request } from "express";
import type { Sequelize } from "sequelize";
import { catalogIds, CunyHttpError } from "../cuny/router.js";
import {
  AdvisorError, classesQuestion, classifyGoals, runOpenAI, suggestSchedule,
  type AdvisorMessage, type CunyCatalog, type RunModel,
} from "./model.js";
import { createAdvisorStore } from "./store.js";

const cookieName = "rmc_advisor";
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const busyResponse = "The schedule advisor is busy. Try again shortly.";

function ownerId(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function sessionToken(request: Request) {
  return request.headers.cookie?.match(/(?:^|;\s*)rmc_advisor=([A-Za-z0-9_-]{43})(?:;|$)/)?.[1];
}

function requiredOwner(request: Request) {
  const token = sessionToken(request);
  if (!token) throw new AdvisorError(409, "Start with your goals in the advisor first.");
  return ownerId(token);
}

function text(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    throw new AdvisorError(400, "Enter a message.");
  }
  return value.trim();
}

export function createAdvisorRouter(database: Sequelize | undefined, catalog: CunyCatalog, runModel: RunModel = runOpenAI) {
  const router = Router();
  const store = database && createAdvisorStore(database);
  let active = 0;
  const usage = new Map<string, { count: number; until: number }>();
  const activeClients = new Set<string>();

  function getStore() {
    if (!store) throw new AdvisorError(503, "Configure PostgreSQL to use the schedule advisor.");
    return store;
  }

  async function useModel<T>(request: Request, work: (signal: AbortSignal) => Promise<T>) {
    const client = request.ip ?? "unknown";
    const now = Date.now();
    for (const [address, limit] of usage) {
      if (limit.until <= now) usage.delete(address);
    }
    const limit = usage.get(client) ?? { count: 0, until: now + 10 * 60_000 };
    const session = sessionToken(request);
    if (limit.count >= 30) throw new AdvisorError(429, "Too many advisor requests. Try again in a few minutes.");
    if (active >= 4 || (session && activeClients.has(session))) throw new AdvisorError(503, busyResponse);
    usage.set(client, { ...limit, count: limit.count + 1 });
    active++;
    if (session) activeClients.add(session);
    const disconnected = new AbortController();
    const abort = () => disconnected.abort();
    request.res?.once("close", abort);
    try {
      return await work(AbortSignal.any([disconnected.signal, AbortSignal.timeout(115_000)]));
    } finally {
      request.res?.off("close", abort);
      active--;
      if (session) activeClients.delete(session);
    }
  }

  router.use((request, response, next) => {
    response.set("Cache-Control", "private, no-store");
    if (request.method !== "GET" && !request.is("application/json")) {
      next(new AdvisorError(415, "Send an application/json request."));
      return;
    }
    next();
  });

  router.get("/schedules", async (request, response) => {
    const token = sessionToken(request);
    response.json({ schedules: store && token ? await store.list(ownerId(token)) : [] });
  });

  router.post("/goals", async (request, response) => {
    const db = getStore();
    const goals = text(request.body?.goals);
    const token = sessionToken(request) ?? randomBytes(32).toString("base64url");
    await useModel(request, async (signal) => {
      const interests = await classifyGoals(goals, runModel, signal);
      signal.throwIfAborted();
      await db.setInterests(ownerId(token), interests);
    });
    response.cookie(cookieName, token, {
      httpOnly: true, secure: request.secure || process.env.NODE_ENV === "production", sameSite: "strict",
      path: "/api/advisor", maxAge: 365 * 24 * 60 * 60 * 1000,
    }).json({ message: classesQuestion });
  });

  router.post("/message", async (request, response) => {
    const db = getStore();
    const owner = requiredOwner(request);
    const { term, college } = catalogIds(request.body?.term, request.body?.college);
    const { messages, requestId } = request.body;
    const goals = text(request.body.goals);
    if (typeof requestId !== "string" || !uuid.test(requestId) || !Array.isArray(messages) ||
        !messages.length || messages.length > 13 || messages.length % 2 !== 1) {
      throw new AdvisorError(400, "Provide a valid advisor conversation.");
    }
    const history: AdvisorMessage[] = messages.map((entry: unknown, index: number) => {
      const role = index % 2 === 0 ? "user" : "assistant";
      if (!entry || typeof entry !== "object" || !("role" in entry) || entry.role !== role || !("content" in entry)) {
        throw new AdvisorError(400, "Provide a valid advisor conversation.");
      }
      return { role, content: text(entry.content) };
    });

    const interests = await db.getInterests(owner);
    if (!interests) throw new AdvisorError(409, "Start with your goals in the advisor first.");
    const previous = await db.find(owner, requestId);
    if (previous) {
      response.json({ message: "I saved your draft in Saved schedules.", schedule: previous });
      return;
    }
    const result = await useModel(request, async (signal) => {
      const { message, draft } = await suggestSchedule(catalog, term, college, goals, history, runModel, signal);
      signal.throwIfAborted();
      const schedule = draft && await db.save(owner, { ...draft, id: requestId, term, college, interests, committed: false });
      return { message, schedule };
    });
    response.json(result);
  });

  router.put("/schedules/:id/commitment", async (request, response) => {
    const db = getStore();
    const owner = requiredOwner(request);
    const { id } = request.params;
    const { committed } = request.body ?? {};
    if (!uuid.test(id) || typeof committed !== "boolean") throw new AdvisorError(400, "Provide a schedule and commitment state.");
    const schedule = await db.setCommitment(owner, id, committed);
    if (!schedule) throw new AdvisorError(404, "This saved schedule could not be found.");
    response.json({ schedules: await db.list(owner) });
  });

  router.get("/matches", async (request, response) => {
    const { term, college } = catalogIds(request.query.term, request.query.college);
    const token = sessionToken(request);
    const classNumbers = store && token ? await store.matchingClasses(ownerId(token), term, college) : [];
    response.json({ classNumbers });
  });

  const handleError: ErrorRequestHandler = (error, _request, response, next) => {
    if (response.headersSent) return next(error);
    if (response.destroyed) return;
    if (error instanceof AdvisorError || error instanceof CunyHttpError) {
      response.status(error.status).json({ error: error.message });
    } else if (error?.name === "AbortError" || error?.name === "TimeoutError") {
      response.status(504).json({ error: "The advisor timed out while planning. Send your message again to use any classes already imported." });
    } else {
      console.error("Advisor request failed", error instanceof Error ? error.name : "Unknown error");
      response.status(503).json({ error: "The schedule advisor is unavailable. Try again shortly." });
    }
  };
  return router.use(handleError);
}
