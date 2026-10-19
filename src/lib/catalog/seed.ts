import directionsSeed from "../../../data/import/seed/directions.json";
import assessmentSeed from "../../../data/import/seed/assessment.json";
import { AssessmentSchema, DirectionsResponseSchema, type Assessment, type DirectionsResponse } from "@/lib/contracts/catalog";

/**
 * Product copy and the self-authored light assessment ship with the app so the
 * first three wizard steps work before any cloud account exists. Numbers are
 * never invented here; coverage counts are only read from the database.
 */
export function seedDirections(): DirectionsResponse {
  const parsed = DirectionsResponseSchema.safeParse({
    category_version: directionsSeed.category_version,
    disclaimer: directionsSeed.disclaimer,
    directions: directionsSeed.directions.map((direction) => ({
      ...direction,
      coverage: {
        exact_major_records: 0,
        official_records: 0,
        job_requirements: 0,
        label: "云端证据尚未载入；方向卡不展示未核证的就业率、薪资或资格结论"
      }
    }))
  });
  if (!parsed.success) {
    throw new Error(`invalid_direction_seed:${parsed.error.issues[0]?.message ?? "unknown"}`);
  }
  return parsed.data;
}

export function seedAssessment(): Assessment {
  const parsed = AssessmentSchema.safeParse({
    version: assessmentSeed.version,
    title: assessmentSeed.title,
    disclaimer: assessmentSeed.disclaimer,
    methodology_sources: assessmentSeed.methodology_sources,
    dimensions: assessmentSeed.dimensions,
    questions: assessmentSeed.questions,
    reverse_scored: assessmentSeed.reverse_scored
  });
  if (!parsed.success) {
    throw new Error(`invalid_assessment_seed:${parsed.error.issues[0]?.message ?? "unknown"}`);
  }
  return parsed.data;
}
