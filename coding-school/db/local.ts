import "server-only";
import { openRepository, type LearnerRepository } from "./repository";
const local = globalThis as typeof globalThis & { codingSchoolRepository?: Promise<LearnerRepository> };
export function getRepository() {
  if (!local.codingSchoolRepository) local.codingSchoolRepository = openRepository(process.env.CODING_SCHOOL_DB_PATH).catch(error => { delete local.codingSchoolRepository; throw error; });
  return local.codingSchoolRepository;
}
