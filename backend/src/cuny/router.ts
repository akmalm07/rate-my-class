import { Router, type ErrorRequestHandler } from "express";
import { DataTypes, Model, type Sequelize } from "sequelize";
import {
  scrapeSchedule, scrapeSelections, scrapeSubjects,
  type Course, type CourseSearchResponse, type Option, type Schedule, type Selections,
} from "./scraper.js";

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

function searchCourses(
  courses: Course[], query: string, codeMatch: RegExpMatchArray | null, subject: string | undefined, openOnly: boolean,
): Course[] {
  const compact = compactCode(query);
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return courses.flatMap((course) => {
    if (subject && course.subject !== subject) return [];
    const catalogText = [course.code, course.subjectName, course.title].join(" ").toLowerCase();
    const matchesCode = codeMatch &&
      course.displaySubject.replace(/\.$/, "").toUpperCase() === codeMatch[1] &&
      course.catalogNumber.toUpperCase() === codeMatch[2];
    if (codeMatch && !matchesCode) return [];
    const matchesCourse = matchesCode || (compact && compactCode(course.code).includes(compact)) ||
      terms.every((term) => catalogText.includes(term));
    const sections = course.sections.filter((section) => {
      if (openOnly && section.status.toLowerCase() !== "open") return false;
      if (matchesCourse) return true;
      const sectionText = `${catalogText} ${section.classNumber} ${section.instructor.toLowerCase()}`;
      return terms.every((term) => sectionText.includes(term));
    });
    return sections.length ? [{ ...course, sections }] : [];
  });
}

export function createCunyRouter(
  database: Sequelize | undefined,
  source = { scrapeSelections, scrapeSchedule, scrapeSubjects },
): Router {
  const router = Router();
  const cache = database?.define<Model<{ key: string; payload: Selections | Schedule | Option[]; fetchedAt: Date }>>(
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
  const subjectRequests = new Map<string, Promise<Option[]>>();
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
    optionsRequest ??= (async () => {
      const table = await getCache();
      const saved = await table.findByPk("selections");
      if (saved && Date.now() - saved.getDataValue("fetchedAt").getTime() < optionLifetime) {
        return saved.getDataValue("payload") as Selections;
      }
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

  function catalogIds(term: unknown, college: unknown) {
    if (typeof term !== "string" || !/^\d{4}$/.test(term) ||
        typeof college !== "string" || !/^[A-Z0-9]{3,12}$/i.test(college)) {
      throw new HttpError(400, "Provide valid term and college IDs.");
    }
    return { term, college: college.toUpperCase() };
  }

  async function checkCatalog(term: string, college: string) {
    const selections = await getSelections();
    if (!selections.terms.some(({ id }) => id === term) || !selections.colleges.some(({ id }) => id === college)) {
      throw new HttpError(400, "Select a term and college listed by Global Search.");
    }
  }

  router.get("/subjects", async (request, response) => {
    const { term, college } = catalogIds(request.query.term, request.query.college);
    const key = `subjects:${term}:${college}`;
    let pending = subjectRequests.get(key);
    if (!pending) {
      pending = (async () => {
        const table = await getCache();
        const schedule = await table.findByPk(`schedule:${term}:${college}`);
        if (schedule) return (schedule.getDataValue("payload") as Schedule).subjects;
        const saved = await table.findByPk(key);
        if (saved && Date.now() - saved.getDataValue("fetchedAt").getTime() < optionLifetime) {
          return saved.getDataValue("payload") as Option[];
        }

        await checkCatalog(term, college);
        let subjects: Option[];
        try {
          subjects = await source.scrapeSubjects(term, college);
        } catch (error) {
          console.error("CUNY subjects import failed:", error);
          if (saved) return saved.getDataValue("payload") as Option[];
          throw new HttpError(502, "Global Search subjects are currently unavailable.");
        }
        await table.upsert({ key, payload: subjects, fetchedAt: new Date() });
        return subjects;
      })().finally(() => subjectRequests.delete(key));
      subjectRequests.set(key, pending);
    }
    response.json(await pending);
  });

  router.get("/courses", async (request, response) => {
    const { term, college } = catalogIds(request.query.term, request.query.college);
    const { q = "", limit = "50", offset = "0", subject: subjectFilter, openOnly = "false" } = request.query;
    if (
      typeof q !== "string" || q.length > 120 ||
      typeof limit !== "string" || !/^\d{1,3}$/.test(limit) || Number(limit) < 1 || Number(limit) > 100 ||
      typeof offset !== "string" || !/^\d{1,8}$/.test(offset) ||
      (openOnly !== "true" && openOnly !== "false") ||
      (subjectFilter !== undefined && (typeof subjectFilter !== "string" || !/^[a-z0-9&/-]{1,20}$/i.test(subjectFilter)))
    ) {
      throw new HttpError(400, "Provide valid query, subject, openOnly, limit (1–100), and offset.");
    }

    const codeMatch = q.trim().toUpperCase().match(/^([A-Z][A-Z&/-]{0,19})\.?\s*(\d[A-Z\d.-]*)$/);
    const subject = subjectFilter?.toUpperCase();
    const importSubject = subject ?? codeMatch?.[1];
    const scheduleKey = `schedule:${term}:${college}`;
    const key = importSubject ? `subject:${term}:${college}:${importSubject}` : scheduleKey;
    const table = await getCache();
    const findSnapshot = async () =>
      (await table.findByPk(scheduleKey)) ?? (importSubject ? await table.findByPk(key) : null);
    let saved = await findSnapshot();
    if (!saved) {
      await checkCatalog(term, college);
      // The snapshot may have been committed while selections were loading.
      saved = await findSnapshot();
    }
    if (saved) {
      const schedule = saved.getDataValue("payload") as Schedule;
      const matches = searchCourses(schedule.courses, q, codeMatch, subject, openOnly === "true");
      const start = Number(offset);
      response.json({
        term: schedule.term,
        college: schedule.college,
        fetchedAt: saved.getDataValue("fetchedAt").toISOString(),
        subjects: schedule.subjects,
        total: matches.length,
        courses: matches.slice(start, start + Number(limit)),
      } satisfies CourseSearchResponse);
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
        const schedule = await source.scrapeSchedule(term, college, importSubject);
        // Publish only after all selected subjects and careers succeed.
        await table.upsert({ key, payload: schedule, fetchedAt: new Date() });
      } catch (error) {
        failedImports.set(key, Date.now() + retryDelay);
        console.error(`CUNY schedule import failed for ${college}/${term}:`, error);
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
