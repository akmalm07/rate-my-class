import { Router, type ErrorRequestHandler } from "express";
import { DataTypes, Model, type Sequelize } from "sequelize";
import { scrapeSchedule, scrapeSelections, type Course, type Schedule, type Selections } from "./scraper.js";

const optionLifetime = 24 * 60 * 60 * 1000;
const retryDelay = 60_000;

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function compactCode(code: string): string {
  return code.toLowerCase().replace(/[\s.-]/g, "");
}

function searchCourses(courses: Course[], query: string, codeMatch: RegExpMatchArray | null): Course[] {
  if (codeMatch) {
    const [, subject, catalogNumber] = codeMatch;
    return courses.filter((course) => course.displaySubject.replace(/\.$/, "").toUpperCase() === subject &&
      course.catalogNumber.toUpperCase() === catalogNumber);
  }
  const compact = compactCode(query);
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return courses;
  return courses.filter((course) => {
    const code = compactCode(course.code);
    const searchable = [course.code, course.subjectName, course.title,
      ...course.sections.flatMap(({ classNumber, instructor }) => [classNumber, instructor]),
    ].join(" ").toLowerCase();
    return (compact && code.includes(compact)) || terms.every((term) => searchable.includes(term));
  });
}

export function createCunyRouter(
  database: Sequelize | undefined,
  source = { scrapeSelections, scrapeSchedule },
): Router {
  const router = Router();
  const cache = database?.define<Model<{ key: string; payload: Selections | Schedule; fetchedAt: Date }>>(
    "CunyGlobalSearchCache",
    {
      key: { type: DataTypes.STRING(48), primaryKey: true },
      payload: { type: DataTypes.JSONB, allowNull: false },
      fetchedAt: { type: DataTypes.DATE, allowNull: false, field: "fetched_at" },
    },
    { tableName: "cuny_global_search_cache", timestamps: false },
  );
  let schema: Promise<unknown> | undefined;
  let optionsRequest: Promise<Selections> | undefined;
  let activeImport: string | undefined;
  const failedImports = new Map<string, number>();

  async function getCache() {
    if (!cache) throw new HttpError(503, "Configure DATABASE_URL to use CUNY search.");
    schema ??= cache.sync().catch((error: unknown) => {
      schema = undefined;
      throw error;
    });
    await schema;
    return cache;
  }

  async function getSelections(): Promise<Selections> {
    const table = await getCache();
    const saved = await table.findByPk("selections");
    if (saved && Date.now() - saved.getDataValue("fetchedAt").getTime() < optionLifetime) {
      return saved.getDataValue("payload") as Selections;
    }

    optionsRequest ??= (async () => {
      let selections: Selections;
      try {
        selections = await source.scrapeSelections();
      } catch (error) {
        console.error("CUNY selections import failed:", error);
        if (saved) return saved.getDataValue("payload") as Selections;
        throw new HttpError(502, "Global Search selections are currently unavailable.");
      }
      await table.upsert({ key: "selections", payload: selections, fetchedAt: new Date() });
      return selections;
    })().finally(() => { optionsRequest = undefined; });
    return optionsRequest;
  }

  router.get("/selections", async (_request, response) => {
    response.json(await getSelections());
  });

  router.get("/courses", async (request, response) => {
    const { term, college, q = "", limit = "50", offset = "0", subject: subjectOverride } = request.query;
    if (
      typeof term !== "string" || !/^\d{4}$/.test(term) ||
      typeof college !== "string" || !/^[A-Z0-9]{3,12}$/i.test(college) ||
      typeof q !== "string" || q.length > 120 ||
      typeof limit !== "string" || !/^\d{1,3}$/.test(limit) || Number(limit) < 1 || Number(limit) > 100 ||
      typeof offset !== "string" || !/^\d{1,8}$/.test(offset)
    ) {
      throw new HttpError(400, "Provide valid term and college IDs, query, limit (1–100), and offset.");
    }

    const collegeId = college.toUpperCase();
    const codeMatch = q.trim().toUpperCase().match(/^([A-Z][A-Z&/-]{0,19})\.?\s*(\d[A-Z\d.-]*)$/);
    if (subjectOverride !== undefined && (!codeMatch ||
        typeof subjectOverride !== "string" || !/^[a-z0-9&/-]{1,20}$/i.test(subjectOverride))) {
      throw new HttpError(400, "The subject filter requires a valid subject ID and exact course code.");
    }
    const subject = subjectOverride?.toUpperCase() ?? codeMatch?.[1];
    const scheduleKey = `schedule:${term}:${collegeId}`;
    const key = subject ? `subject:${term}:${collegeId}:${subject}` : scheduleKey;
    const table = await getCache();
    const findSnapshot = async () =>
      (await table.findByPk(scheduleKey)) ?? (subject ? await table.findByPk(key) : null);
    let saved = await findSnapshot();
    if (!saved) {
      const selections = await getSelections();
      // The snapshot may have been committed while selections were loading.
      saved = await findSnapshot();
      if (!saved && (
        !selections.terms.some(({ id }) => id === term) ||
        !selections.colleges.some(({ id }) => id === collegeId)
      )) {
        throw new HttpError(400, "Select a term and college listed by Global Search.");
      }
    }
    if (saved) {
      const schedule = saved.getDataValue("payload") as Schedule;
      const matches = searchCourses(schedule.courses, q, codeMatch);
      const start = Number(offset);
      response.json({
        term: schedule.term,
        college: schedule.college,
        fetchedAt: saved.getDataValue("fetchedAt"),
        subjects: schedule.subjects,
        total: matches.length,
        courses: matches.slice(start, start + Number(limit)),
      });
      return;
    }

    if (activeImport === key || activeImport === scheduleKey) {
      response.set("Retry-After", "5").status(202).json({ status: "importing" });
      return;
    }
    const now = Date.now();
    for (const [failed, retryAt] of failedImports) {
      if (retryAt <= now) failedImports.delete(failed);
    }
    if (failedImports.has(key)) {
      response.set("Retry-After", "60");
      throw new HttpError(502, "The Global Search import failed. Try again shortly.");
    }
    if (activeImport) {
      response.set("Retry-After", "10");
      throw new HttpError(503, "Another Global Search import is running. Try again shortly.");
    }

    activeImport = key;
    void (async () => {
      try {
        const schedule = await source.scrapeSchedule(term, collegeId, subject);
        // Publish only after all selected subjects and careers succeed.
        await table.upsert({ key, payload: schedule, fetchedAt: new Date() });
      } catch (error) {
        failedImports.set(key, Date.now() + retryDelay);
        console.error(`CUNY schedule import failed for ${collegeId}/${term}:`, error);
      } finally {
        activeImport = undefined;
      }
    })();
    response.set("Retry-After", "5").status(202).json({ status: "importing" });
  });

  const handleError: ErrorRequestHandler = (error, _request, response, next) => {
    if (response.headersSent) {
      next(error);
      return;
    }
    if (error instanceof HttpError) {
      response.status(error.status).json({ error: error.message });
      return;
    }
    console.error("CUNY cache request failed:", error);
    response.status(503).json({ error: "The CUNY search cache is unavailable." });
  };
  router.use(handleError);
  return router;
}
