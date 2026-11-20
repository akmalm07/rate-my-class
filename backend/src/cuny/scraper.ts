import { chromium, type Locator, type Page, type Response } from "playwright";

export const globalSearchUrl = "https://globalsearch.cuny.edu/CFGlobalSearchTool/search.jsp";

interface Option {
  id: string;
  name: string;
}

export interface Selections {
  terms: Option[];
  colleges: Option[];
}

export interface Section {
  classNumber: string;
  section: string;
  daysAndTimes: string;
  room: string;
  instructor: string;
  instructionMode: string;
  meetingDates: string;
  status: string;
  topic: string;
}

export interface Course {
  code: string;
  subject: string;
  subjectName: string;
  displaySubject: string;
  catalogNumber: string;
  title: string;
  career: string;
  sections: Section[];
}

export interface Schedule {
  term: string;
  college: string;
  subjects: Option[];
  courses: Course[];
}

function clean(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

async function withPage<T>(work: (page: Page) => Promise<T>): Promise<T> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(20_000);
    page.on("dialog", (dialog) => void dialog.dismiss());
    // Forms and result data only. No images, fonts, or stylesheets are needed.
    await page.route("**/*", (route) =>
      ["image", "font", "stylesheet"].includes(route.request().resourceType())
        ? route.abort()
        : route.continue(),
    );
    checkResponse(await page.goto(globalSearchUrl, { waitUntil: "domcontentloaded" }));
    return await work(page);
  } finally {
    await browser.close();
  }
}

function checkResponse(response: Response | null): void {
  if (!response?.ok()) {
    throw new Error(`Global Search returned HTTP ${response?.status() ?? "unknown"}`);
  }
}

async function submit(page: Page, selector: string): Promise<void> {
  const [response] = await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded" }),
    page.locator(selector).click(),
  ]);
  checkResponse(response);
}

async function options(select: Locator): Promise<Option[]> {
  await select.waitFor({ state: "attached" });
  return (await select.locator("option").evaluateAll((elements) =>
    (elements as HTMLOptionElement[]).map((option) => ({
      id: option.value,
      name: option.textContent ?? "",
    })),
  )).filter(({ id }) => id.trim()).map(({ id, name }) => ({ id, name: clean(name) }));
}

export async function scrapeSelections(): Promise<Selections> {
  return withPage(async (page) => {
    const terms = await options(page.locator("#t_pd"));
    const colleges = (await page.locator("input[name=inst_selection]").evaluateAll((inputs) =>
      (inputs as HTMLInputElement[]).map((input) => ({
        id: input.value,
        name: document.querySelector(`label[for="${CSS.escape(input.id)}"]`)?.textContent ?? "",
      })),
    )).map(({ id, name }) => ({ id, name: clean(name) }));
    if (!terms.length || !colleges.length || colleges.some(({ id, name }) => !id || !name)) {
      throw new Error("Global Search selection fields are missing or incomplete");
    }
    return { terms, colleges };
  });
}

export async function readResults(page: Page, subject: Option, career: string): Promise<Course[]> {
  const groups = await page.locator('a[aria-label="Class Section Sub"]').evaluateAll((links) =>
    links.map((link) => {
      const suffix = link.id.replace(/^imageDivLink/, "");
      const rows = document.querySelectorAll(`#contentDivImg${CSS.escape(suffix)} table.classinfo tbody tr`);
      return {
        heading: link.parentElement?.textContent ?? "",
        sections: Array.from(rows, (row) => {
          const cells = Object.fromEntries(
            Array.from(row.querySelectorAll("td[data-label]"), (cell) => [
              cell.getAttribute("data-label"), cell.textContent ?? "",
            ]),
          );
          return {
            classNumber: cells.Class ?? "",
            section: cells.Section ?? "",
            daysAndTimes: cells.DaysAndTimes ?? "",
            room: cells.Room ?? "",
            instructor: cells.Instructor ?? "",
            instructionMode: cells["Instruction Mode"] ?? "",
            meetingDates: cells["Meeting Dates"] ?? "",
            status: row.querySelector('td[data-label="Status"] img')?.getAttribute("title") ?? cells.Status ?? "",
            topic: cells["Course Topic"] ?? "",
          };
        }),
      };
    }),
  );
  const body = clean(await page.locator("body").textContent() ?? "");
  if (!groups.length && body.includes("The search returns no results that match the criteria specified.")) {
    return [];
  }
  const count = body.match(/([\d,]+) class section\(s\) found/i)?.[1];
  const rows = groups.reduce((total, group) => total + group.sections.length, 0);
  if (!groups.length || !count || Number(count.replaceAll(",", "")) !== rows) {
    throw new Error(`Unexpected or truncated Global Search results for ${subject.id}/${career}`);
  }

  return groups.map(({ heading, sections }) => {
    const match = clean(heading).match(/^(.+?) - (.+)$/);
    const displayCode = match?.[1].match(/^(\S+) (.+)$/);
    if (!match || !displayCode ||
        !sections.length || sections.some(({ classNumber }) => !/^\d+$/.test(clean(classNumber)))) {
      throw new Error(`Unrecognized course result for ${subject.id}/${career}: ${clean(heading)}`);
    }
    const [, code, title] = match;
    return {
      code,
      title,
      subject: subject.id,
      subjectName: subject.name,
      displaySubject: displayCode[1],
      catalogNumber: displayCode[2],
      career,
      sections: sections.map((section) => ({
        classNumber: clean(section.classNumber),
        section: clean(section.section),
        daysAndTimes: clean(section.daysAndTimes),
        room: clean(section.room),
        instructor: clean(section.instructor),
        instructionMode: clean(section.instructionMode),
        meetingDates: clean(section.meetingDates),
        status: clean(section.status),
        topic: clean(section.topic),
      })),
    };
  });
}

export async function scrapeSchedule(term: string, college: string, subjectId?: string): Promise<Schedule> {
  return withPage(async (page) => {
    await page.locator("#t_pd").selectOption(term);
    await page.locator(`label[for="${college}"]`).click();
    await submit(page, "input[name=next_btn]");
    const subjects = await options(page.locator("#subject_ld"));
    const careers = await options(page.locator("#courseCareerId"));
    if (!subjects.length || !careers.length) {
      throw new Error(`Global Search did not provide subjects and careers for ${college}/${term}`);
    }

    const selectedSubjects = subjectId ? subjects.filter(({ id }) => id === subjectId) : subjects;
    const courses: Course[] = [];
    for (const subject of selectedSubjects) {
      for (const career of careers) {
        // Submit one subject and career at a time, including closed sections.
        await page.locator("#subject_ld").selectOption(subject.id);
        await page.locator("#courseCareerId").selectOption(career.id);
        await page.locator("#open_class_id").uncheck();
        await submit(page, "input[name=search_btn_search]");
        const results = await readResults(page, subject, career.id);
        courses.push(...results);
        if (results.length) {
          await page.goBack({ waitUntil: "domcontentloaded" });
        }
        await page.locator("#subject_ld").waitFor();
        // Keep the importer sequential and space requests to the public site.
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    return { term, college, subjects: selectedSubjects, courses };
  });
}
