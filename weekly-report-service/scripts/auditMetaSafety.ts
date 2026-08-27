import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const files = walk(root).filter((file) => !file.includes("node_modules") && !file.includes(`${path.sep}.git${path.sep}`));
const bad = files.flatMap((file) => {
  if (file.endsWith("scripts/auditMetaSafety.ts")) return [];
  const text = stripRequiredSafetyBlock(fs.readFileSync(file, "utf8"));
  const findings: string[] = [];
  if (text.includes("ads_management")) findings.push("forbidden Meta management scope mention");
  if (text.includes("graph.facebook.com")) findings.push("forbidden raw Meta host mention");
  return findings.map((finding) => `${file}: ${finding}`);
});

if (bad.length) {
  console.error(bad.join("\n"));
  process.exit(1);
}
console.info("Meta safety audit passed.");

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function stripRequiredSafetyBlock(text: string) {
  return text.replace(/\/\*\n## 2\. Non-negotiable constraint: Meta account safety[\s\S]*?\*\//, "");
}
