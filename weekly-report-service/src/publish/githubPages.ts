import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export function publishToGithubPages(reportFile: string, weekStart: string): string {
  if (process.env.GITHUB_ACTIONS !== "true") {
    throw new Error("GitHub Pages publishing must run inside GitHub Actions. Set NOTIFICATION_CHANNEL=local to render without publishing.");
  }

  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) throw new Error("GITHUB_REPOSITORY is not set");
  const [owner, repoName] = repo.split("/");
  if (!owner || !repoName) throw new Error(`GITHUB_REPOSITORY must be in owner/repo format, received: ${repo}`);

  const repoRoot = process.env.GITHUB_WORKSPACE;
  if (!repoRoot) throw new Error("GITHUB_WORKSPACE is not set");

  const docsDir = path.join(repoRoot, "docs", "reports");
  fs.mkdirSync(docsDir, { recursive: true });
  const destName = `${weekStart}.html`;
  const dest = path.join(docsDir, destName);
  fs.copyFileSync(reportFile, dest);

  fs.copyFileSync(reportFile, path.join(docsDir, "latest.html"));

  execSync(`git config user.name "weekly-report-bot"`, { cwd: repoRoot, stdio: "inherit" });
  execSync(`git config user.email "actions@users.noreply.github.com"`, { cwd: repoRoot, stdio: "inherit" });
  execSync(`git add docs/reports`, { cwd: repoRoot, stdio: "inherit" });
  execSync(`git commit -m "Publish report for week of ${weekStart}" --allow-empty`, { cwd: repoRoot, stdio: "inherit" });
  execSync(`git push`, { cwd: repoRoot, stdio: "inherit" });

  return `https://${owner}.github.io/${repoName}/reports/${destName}`;
}
