const WRAPPER = "assert-clean-tmpdir.mjs";

const BARE_RUNNERS = /(^|[\s;&|])(vitest|pytest|cargo test)([\s]|$)/;

export function unwrappedRunners(command) {
  return command
    .split("&&")
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !part.includes(WRAPPER));
}

export function findViolations({ scripts, workflowLines }) {
  const violations = [];

  for (const { name, scripts: byName } of scripts) {
    for (const [script, command] of Object.entries(byName)) {
      if (script !== "test" && !script.startsWith("test:")) {
        continue;
      }

      for (const runner of unwrappedRunners(command)) {
        violations.push(`${name} script ${script} runs "${runner}" unwrapped`);
      }
    }
  }

  for (const { file, line } of workflowLines) {
    if (BARE_RUNNERS.test(line) && !line.includes(WRAPPER)) {
      violations.push(`${file} runs "${line.trim()}" unwrapped`);
    }
  }

  return violations;
}
