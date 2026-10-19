#!/usr/bin/env node
import { SAFETY_FIXTURES } from "./fixtures/safety.js";
import { replaySafetyFixtures } from "./replay.js";

const results = await replaySafetyFixtures(SAFETY_FIXTURES);
const failed = results.filter((r) => !r.pass);

for (const r of results) {
  const mark = r.pass ? "PASS" : "FAIL";
  console.log(`${mark} ${r.id}: expected=${r.expected} actual=${r.actual}`);
}

console.log(`\n${results.length - failed.length}/${results.length} passed`);

if (failed.length) {
  process.exitCode = 1;
}
