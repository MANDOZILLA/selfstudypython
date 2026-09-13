import { handleLearnerRequest } from "../../../db/http";
import { getRepository } from "../../../db/local";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = (request: Request) => handleLearnerRequest(request, getRepository);
export const PUT = (request: Request) => handleLearnerRequest(request, getRepository);
