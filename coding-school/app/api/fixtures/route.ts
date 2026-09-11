import { z } from "zod";
import { paymentsCsv } from "../../../public/grading/catalog.js";
const schema = z.enum(["payments", "customers"]);
const fixtures = { payments: paymentsCsv, customers: [{ id: "cus_11", name: "Ari" }] };
export function GET(request: Request) { const parsed = schema.safeParse(new URL(request.url).searchParams.get("dataset")); return parsed.success ? Response.json({ data: fixtures[parsed.data], source: "local-fixture" }) : Response.json({ error: "Unknown fixture dataset" }, { status: 400 }); }
