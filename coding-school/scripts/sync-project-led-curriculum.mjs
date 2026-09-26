import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const source = new URL("../curriculum/project-led.txt", import.meta.url);
const target = new URL("../curriculum/project-led.json", import.meta.url);
const text = (await readFile(source, "utf8")).replace(/\r\n/g, "\n").trim();
const chunks = text.split(/\n={50}\n/);

if (chunks.length !== 35) throw new Error(`Expected 17 numbered sections, found ${(chunks.length - 1) / 2}`);

const sections = [];
for (let index = 1; index < chunks.length; index += 2) {
  const [heading, ...headingDetails] = chunks[index].trim().split("\n");
  const match = /^(\d+)\. (.+)$/.exec(heading);
  if (!match) throw new Error(`Unexpected section heading: ${heading}`);

  const content = chunks[index + 1].trim();
  const unitPattern = /-{35}\nUNIT (\d+) — ([^\n]+)\n-{35}\n/g;
  const unitHeaders = [...content.matchAll(unitPattern)];
  const intro = content.slice(0, unitHeaders[0]?.index ?? content.length).trim();
  const units = unitHeaders.map((unit, unitIndex) => ({
    number: Number(unit[1]),
    title: unit[2],
    content: content.slice(unit.index + unit[0].length, unitHeaders[unitIndex + 1]?.index ?? content.length).trim(),
  }));

  sections.push({
    number: Number(match[1]),
    title: match[2],
    duration: headingDetails.find(line => line.startsWith("DURATION:"))?.slice(9).trim() ?? null,
    intro,
    units,
  });
}

const phaseSections = sections.filter(section => section.title.startsWith("PHASE "));
const unitCount = sections.reduce((count, section) => count + section.units.length, 0);
if (phaseSections.length !== 9 || unitCount !== 20) {
  throw new Error(`Expected nine phases and twenty units, found ${phaseSections.length} phases and ${unitCount} units`);
}

const document = { title: chunks[0].split("\n")[0], overview: chunks[0].split("\n").slice(1).join("\n").trim(), sections };
await writeFile(target, `${JSON.stringify(document, null, 2)}\n`, "utf8");
console.log(`Updated ${fileURLToPath(target)}: ${phaseSections.length} phases, ${unitCount} units`);
