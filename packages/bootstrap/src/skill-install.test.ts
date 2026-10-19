import { describe, expect, it } from "vitest";
import { mkdirSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { installDecideRouterSkill } from "./skill-install.js";

const skillSource = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../skills/decide-router",
);

describe("skill installer", () => {
  it("copies SKILL.md and records skills-lock", () => {
    expect(existsSync(join(skillSource, "SKILL.md"))).toBe(true);

    const root = join(tmpdir(), `dr-skill-${Date.now()}`);
    mkdirSync(join(root, ".claude"), { recursive: true });
    try {
      const result = installDecideRouterSkill({
        root,
        yes: true,
        skillSource,
      });
      expect(result.installed.length).toBeGreaterThan(0);
      const claudeSkill = join(
        root,
        ".claude",
        "skills",
        "decide-router",
        "SKILL.md",
      );
      expect(existsSync(claudeSkill)).toBe(true);
      expect(readFileSync(claudeSkill, "utf8")).toMatch(/Judgment/);
      expect(
        existsSync(
          join(root, ".claude", "skills", "decide-router", "skills-lock.json"),
        ),
      ).toBe(true);
      expect(existsSync(join(root, ".decide-router", "SKILL.md"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
