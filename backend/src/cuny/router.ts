import { Router, type ErrorRequestHandler } from "express";
import { DataTypes, Model, Op, type Sequelize } from "sequelize";
import {
  scrapeSchedule, scrapeSelections, scrapeSubjects,
  type Course, type CourseSearchResponse, type Option, type Schedule, type Selections,
} from "./scraper.js";

const optionLifetime = 24 * 60 * 60 * 1000;
const retryDelay = 60_000;

export class CunyHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function compactCode(code: string): string {
  return code.toLowerCase().replace(/[\s.-]/g, "");
}

function searchCourses(
  courses: Course[], query: string, codeMatch: RegExpMatchArray | null, subject: string | undefined, openOnly: boolean,
  career?: string,
): Course[] {
  const compact = compactCode(query);
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return courses.flatMap((course) => {
    if ((subject && course.subject !== subject) || (career && course.career !== career)) return [];
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

export function createCunyCatalog(
  database: Sequelize | undefined,
  source = { scrapeSelections, scrapeSchedule, scrapeSubjects },
) {
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
    if (!cache) throw new CunyHttpError(503, "Configure DATABASE_URL to use CUNY search.");
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
        throw new CunyHttpError(502, "Global Search selections are currently unavailable.");
      }
      await table.upsert({ key: "selections", payload: selections, fetchedAt: new Date() });
      return selections;
    })().finally(() => { optionsRequest = undefined; });
    return optionsRequest;
  }

  async function checkCatalog(term: string, college: string) {
    const selections = await getSelections();
    if (!selections.terms.some(({ id }) => id === term) || !selections.colleges.some(({ id }) => id === college)) {
      throw new CunyHttpError(400, "Select a term and college listed by Global Search.");
    }
  }

  async function getSubjects(term: string, college: string) {
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
          throw new CunyHttpError(502, "Global Search subjects are currently unavailable.");
        }
        await table.upsert({ key, payload: subjects, fetchedAt: new Date() });
        return subjects;
      })().finally(() => subjectRequests.delete(key));
      subjectRequests.set(key, pending);
    }
    return pending;
  }

  async function getCourses(term: string, college: string, q: string, subject: string | undefined, openOnly: boolean, limit: number, offset: number, career?: string) {
    const codeMatch = q.trim().toUpperCase().match(/^([A-Z][A-Z&/-]{0,19})\.?\s*(\d[A-Z\d.-]*)$/);
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
      const matches = searchCourses(schedule.courses, q, codeMatch, subject, openOnly, career);
      const result: CourseSearchResponse = {
        term: schedule.term,
        college: schedule.college,
        fetchedAt: saved.getDataValue("fetchedAt").toISOString(),
        subjects: schedule.subjects,
        total: matches.length,
        courses: matches.slice(offset, offset + limit),
      };
      return { status: 200, result } as const;
    }

    if (activeImport === key || activeImport === scheduleKey) {
      return { status: 202, retryAfter: 5 } as const;
    }
    const now = Date.now();
    for (const [failed, retryAt] of failedImports) {
      if (retryAt <= now) failedImports.delete(failed);
    }
    if (failedImports.has(key)) {
      return { status: 502, retryAfter: 60, error: "The Global Search import failed. Try again shortly." } as const;
    }
    if (activeImport) {
      return { status: 503, retryAfter: 10, error: "Another Global Search import is running. Try again shortly." } as const;
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
    return { status: 202, retryAfter: 5 } as const;
  }

  async function getCachedCourses(term: string, college: string, subjects: string[]) {
    const table = await getCache();
    const full = await table.findByPk(`schedule:${term}:${college}`);
    if (full) return { complete: true, courses: (full.getDataValue("payload") as Schedule).courses };
    const keys = subjects.map((subject) => `subject:${term}:${college}:${subject}`);
    const snapshots = await table.findAll({ where: { key: { [Op.in]: keys } } });
    return {
      complete: keys.length > 0 && snapshots.length === keys.length,
      courses: snapshots.flatMap((snapshot) => (snapshot.getDataValue("payload") as Schedule).courses),
    };
  }

  return { getSelections, checkCatalog, getSubjects, getCourses, getCachedCourses };
}

export function catalogIds(term: unknown, college: unknown) {
  if (typeof term !== "string" || !/^\d{4}$/.test(term) ||
      typeof college !== "string" || !/^[A-Z0-9]{3,12}$/i.test(college)) {
    throw new CunyHttpError(400, "Provide valid term and college IDs.");
  }
  return { term, college: college.toUpperCase() };
}

export function createCunyRouter(
  database: Sequelize | undefined,
  source?: Parameters<typeof createCunyCatalog>[1],
  catalog = createCunyCatalog(database, source),
): Router {
  const router = Router();
  router.get("/selections", async (_request, response) => {
    response.json(await catalog.getSelections());
  });
  router.get("/subjects", async (request, response) => {
    const { term, college } = catalogIds(request.query.term, request.query.college);
    response.json(await catalog.getSubjects(term, college));
  });
  router.get("/courses", async (request, response) => {
    const { term, college } = catalogIds(request.query.term, request.query.college);
    const { q = "", limit = "50", offset = "0", subject, openOnly = "false" } = request.query;
    if (
      typeof q !== "string" || q.length > 120 ||
      typeof limit !== "string" || !/^\d{1,3}$/.test(limit) || Number(limit) < 1 || Number(limit) > 100 ||
      typeof offset !== "string" || !/^\d{1,8}$/.test(offset) ||
      (openOnly !== "true" && openOnly !== "false") ||
      (subject !== undefined && (typeof subject !== "string" || !/^[a-z0-9&/-]{1,20}$/i.test(subject)))
    ) {
      throw new CunyHttpError(400, "Provide valid query, subject, openOnly, limit (1–100), and offset.");
    }
    const search = await catalog.getCourses(term, college, q, subject?.toUpperCase(), openOnly === "true", Number(limit), Number(offset));
    if (search.status === 200) {
      response.json(search.result);
      return;
    }
    response.set("Retry-After", String(search.retryAfter)).status(search.status)
      .json(search.status === 202 ? { status: "importing" } : { error: search.error });
  });

  const handleError: ErrorRequestHandler = (error, _request, response, next) => {
    if (response.headersSent) {
      next(error);
      return;
    }
    if (error instanceof CunyHttpError) {
      response.status(error.status).json({ error: error.message });
      return;
    }
    console.error("CUNY cache request failed:", error);
    response.status(503).json({ error: "The CUNY search cache is unavailable." });
  };
  router.use(handleError);
  return router;
}
