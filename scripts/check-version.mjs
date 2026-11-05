// Release guard: the pushed tag, manifest.json and package.json must agree on the version.
// Usage: node scripts/check-version.mjs [tag]   (no argument: $GITHUB_REF_NAME; "" skips the tag check)
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dirname, "..");
const manifest = JSON.parse(readFileSync(join(repoRoot, "manifest.json"), "utf8"));
const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
// An explicit argument (even "") wins; the env fallback is only for running without arguments.
const tag = process.argv.length > 2 ? process.argv[2] : (process.env.GITHUB_REF_NAME || "");

const problems = [];
if (manifest.version !== pkg.version) {
  problems.push(`manifest.json version ${manifest.version} != package.json version ${pkg.version}`);
}
if (tag && tag !== `v${manifest.version}`) {
  problems.push(`tag ${tag} != v${manifest.version} (manifest.json)`);
}
if (problems.length) {
  for (const p of problems) console.error(`[check-version] ${p}`);
  process.exit(1);
}
console.log(`[check-version] OK: ${tag || "(no tag)"} / manifest ${manifest.version} / package ${pkg.version}`);
