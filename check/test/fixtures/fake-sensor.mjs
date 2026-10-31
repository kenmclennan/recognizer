import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const [, commit, output, mode = "valid"] = process.argv.slice(2);

const finding = {
  id: "fake-violation:shop/domain/order.py",
  kind: "fake-violation",
  severity: "violation",
  principle: "fake-principle",
  summary: "the fake sensor objects to shop/domain/order.py",
  evidence: { modules: ["shop/domain/order.py"] },
};

const document = {
  findings_version: 1,
  sensor: {
    name: mode === "other-name" ? "someone-else" : "fake-sensor",
    version: "1",
  },
  commit: mode === "wrong-commit" ? "not-the-commit" : commit,
  modified: false,
  settings: {},
  findings: [finding],
};

if (mode === "nothing") {
  process.exit(0);
}

if (mode === "fail") {
  process.stderr.write("the fake sensor broke\n");
  process.exit(3);
}

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, mode === "bad-json" ? "{" : JSON.stringify(document));
