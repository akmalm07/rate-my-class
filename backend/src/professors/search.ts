import { createConfig, RMPClient } from "ratemyprofessors-client";

export interface ProfessorSearchOptions {
  schoolId?: string;
  limit?: number;
  cursor?: string;
}

const config = createConfig({ timeout_seconds: 8, max_retries: 1 });

export async function searchProfessors(name: string, options: ProfessorSearchOptions = {}) {
  // The SDK uses one abort controller per client. Isolate concurrent lookups.
  const client = new RMPClient(config);
  try {
    const result = await client.searchProfessors(name.trim(), {
      school_id: options.schoolId,
      page_size: options.limit ?? 20,
      cursor: options.cursor,
    });

    return {
      total: result.total ?? null,
      nextCursor: result.has_next_page ? result.next_cursor ?? null : null,
      professors: result.professors.map((professor) => ({
        id: professor.id,
        name: professor.name,
        department: professor.department ?? null,
        school: professor.school ? { id: professor.school.id, name: professor.school.name } : null,
        overallRating: professor.num_ratings === 0 ? null : professor.overall_rating ?? null,
        ratingCount: professor.num_ratings ?? null,
        difficulty: professor.num_ratings === 0 ? null : professor.level_of_difficulty ?? null,
        wouldTakeAgainPercent: professor.percent_take_again != null && professor.percent_take_again >= 0
          ? professor.percent_take_again
          : null,
      })),
    };
  } finally {
    await client.close();
  }
}

export type ProfessorSearchResponse = Awaited<ReturnType<typeof searchProfessors>>;
