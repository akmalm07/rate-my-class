import { Router } from "express";
import { searchProfessors } from "./search.js";

export const professorRouter = Router();

// Rate My Professors school IDs verified against its school directory.
const schoolIds = new Map(Object.entries({
  BAR01: "222", BMC01: "18470", BCC01: "4257", BKL01: "223", CTY01: "224",
  CSI01: "225", GRD01: "5060", NCC01: "16756", HOS01: "5136", HTR01: "226",
  JJC01: "227", KCC01: "4105", LAG01: "4269", LEH01: "228", MEC01: "229",
  NYT01: "230", QNS01: "231", QCC01: "4141", SOJ01: "17638", SLU01: "17785",
  LAW01: "5176", SPS01: "14617", SPH01: "17230", YRK01: "13771",
}));

function normalizeName(name: string) {
  return name.normalize("NFKD").toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();
}

professorRouter.get("/search", async (request, response) => {
  const { q, schoolId, college, limit = "20", cursor } = request.query;
  const name = typeof q === "string" ? q.trim() : "";
  if (
    !name || name.length > 120 ||
    (college !== undefined && (typeof college !== "string" || !/^[a-z0-9]{3,12}$/i.test(college) ||
      schoolId !== undefined || cursor !== undefined)) ||
    (schoolId !== undefined && (typeof schoolId !== "string" || !/^[1-9]\d{0,11}$/.test(schoolId))) ||
    typeof limit !== "string" || !/^\d{1,2}$/.test(limit) || Number(limit) < 1 || Number(limit) > 50 ||
    (cursor !== undefined && (typeof cursor !== "string" || !cursor.trim() || cursor.length > 512))
  ) {
    response.status(400).json({ error: "Provide a professor name as q and valid search parameters." });
    return;
  }

  const collegeSchoolId = college && schoolIds.get(college.toUpperCase());
  if (college && !collegeSchoolId) {
    response.status(404).json({ error: "Ratings are unavailable for this college." });
    return;
  }

  try {
    if (collegeSchoolId) {
      const result = await searchProfessors(name, { schoolId: collegeSchoolId });
      const matches = result.professors.filter((professor) =>
        professor.school?.id === collegeSchoolId && normalizeName(professor.name) === normalizeName(name),
      );
      const professors = matches.length === 1 ? matches : [];
      response.json({ professors, total: professors.length, nextCursor: null });
      return;
    }
    response.json(await searchProfessors(name, { schoolId, limit: Number(limit), cursor }));
  } catch (error) {
    console.error("Rate My Professors search failed:", error instanceof Error ? error.name : "Unknown error");
    response.status(502).json({ error: "Rate My Professors search is currently unavailable." });
  }
});
