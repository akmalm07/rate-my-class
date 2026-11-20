import { Router } from "express";
import { searchProfessors } from "./search.js";

export const professorRouter = Router();

professorRouter.get("/search", async (request, response) => {
  const { q, schoolId, limit = "20", cursor } = request.query;
  const name = typeof q === "string" ? q.trim() : "";
  if (
    !name || name.length > 120 ||
    (schoolId !== undefined && (typeof schoolId !== "string" || !/^[1-9]\d{0,11}$/.test(schoolId))) ||
    typeof limit !== "string" || !/^\d{1,2}$/.test(limit) || Number(limit) < 1 || Number(limit) > 50 ||
    (cursor !== undefined && (typeof cursor !== "string" || !cursor.trim() || cursor.length > 512))
  ) {
    response.status(400).json({ error: "Provide a professor name as q and valid schoolId, limit (1–50), and cursor if needed." });
    return;
  }

  try {
    response.json(await searchProfessors(name, { schoolId, limit: Number(limit), cursor }));
  } catch (error) {
    console.error("Rate My Professors search failed:", error instanceof Error ? error.name : "Unknown error");
    response.status(502).json({ error: "Rate My Professors search is currently unavailable." });
  }
});
