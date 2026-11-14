import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";
import { describe, expect, it } from "vitest";
import { HIDE_SCROLLBARS, lookBrowserArgs, webkit } from "./look-page";

const here = (name: string) => fileURLToPath(new URL(name, import.meta.url));

const HARNESS = `
import { openSetupModal } from ${JSON.stringify(here("setup-modal-view.ts"))};
import { fakeSetup } from ${JSON.stringify(here("setup-fake.ts"))};

const doctor = (problems) => ({ status: "ok", report: { repository: "/r", ok: problems === 0, problems, warnings: 0, areas: [{ name: "config", skipped: null, problems: Array.from({ length: problems }, (_, i) => ({ code: "config-retired", subject: "k" + i, line: "problem " + i, fix: { text: "fix", command: null }, severity: "problem" })) }] } });
const proposal = {
  summary: "A draft",
  changes: [
    { section: "problems", title: "Drop key", reason: "retired", commands: [["recognizer", "config", "--unset", "a.b"]] },
    { section: "problems", title: "Add suite", reason: "tests exist", commands: [["recognizer", "config", "tests.api.command", "pytest"]] },
    { section: "tests", title: "Run the suites", reason: "prove them", commands: [["recognizer", "sensors", "check", "--run"]] },
    { section: "policy", title: "Draft layers", reason: "two layers", commands: [["recognizer", "policy", "--add", "levels", "core"]] },
  ],
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));
const box = (node) => { const r = node.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height }; };
const facts = {};

(async () => {
  const fake = fakeSetup({
    doctor: doctor(2),
    progress: ["Read .recognizer/policy.yaml", "Bash recognizer doctor"],
    checkResult: { status: "proposal", output: proposal, costUsd: 0.42, durationMs: 83000, denials: 0 },
  });
  let release = () => {};
  fake.gate = new Promise((resolve) => { release = resolve; });
  const modal = openSetupModal({ port: fake, readModel: async () => "sonnet" });
  await modal.ready;
  const q = (selector) => modal.element.querySelector(selector);
  const qa = (selector) => [...modal.element.querySelectorAll(selector)];
  const foot = () => qa(".sm-foot button").map((b) => b.textContent);

  facts.start = {
    lines: qa(".su-line").map((n) => n.textContent),
    estimate: q(".su-estimate").textContent,
    foot: foot(),
    callsAfterOpen: fake.calls.slice(),
    insideScrim: box(q(".settings-modal")).width <= box(modal.element).width && box(q(".settings-modal")).height <= box(modal.element).height,
    paneFitsModal: box(q(".sm-pane")).right <= box(q(".settings-modal")).right && box(q(".sm-pane")).bottom <= box(q(".settings-modal")).bottom,
  };

  const checking = modal.controller.check();
  await settle();
  facts.checking = { progress: qa(".su-progress").map((n) => n.textContent), foot: foot() };
  release();
  await checking;
  await settle();

  facts.report = {
    nav: qa(".sm-entry").map((n) => n.textContent),
    head: q(".su-run").textContent,
    changes: qa(".su-change-title").map((n) => n.textContent),
    checked: qa(".su-change input").map((n) => n.checked),
    badges: qa(".su-badge").map((n) => n.textContent),
    commands: qa(".su-command").map((n) => n.textContent),
    applyDisabled: qa(".sm-foot button").find((b) => b.textContent === "Apply").disabled,
    sameLeftEdge: new Set(qa(".su-change").map((n) => box(n).left)).size === 1,
  };

  qa(".sm-entry").find((n) => n.dataset.section === "tests").click();
  facts.tests = {
    nav: qa(".sm-entry").map((n) => n.textContent),
    changes: qa(".su-change-title").map((n) => n.textContent),
    badges: qa(".su-badge").map((n) => n.textContent),
    checked: qa(".su-change input").map((n) => n.checked),
  };
  q(".su-change input").click();
  facts.afterTick = { nav: qa(".sm-entry").map((n) => n.textContent) };

  qa(".sm-entry").find((n) => n.dataset.section === "problems").click();
  facts.problemsAgain = { nav: qa(".sm-entry").map((n) => n.textContent) };

  await modal.controller.apply();
  await settle();
  facts.applied = { text: qa(".su-line").map((n) => n.textContent), foot: foot(), ran: fake.ran.map((a) => a.join(" ")) };

  const empty = fakeSetup({ doctor: doctor(0), checkResult: { status: "proposal", output: { changes: [] }, costUsd: 0.1, durationMs: 4000, denials: 0 } });
  modal.close();
  const second = openSetupModal({ port: empty, readModel: async () => "sonnet" });
  await second.ready;
  await second.controller.check();
  await settle();
  const sq = (selector) => second.element.querySelector(selector);
  facts.empty = { text: sq(".su-empty").textContent, applyDisabled: [...second.element.querySelectorAll(".sm-foot button")].find((b) => b.textContent === "Apply").disabled, nav: [...second.element.querySelectorAll(".sm-entry")].map((n) => n.textContent) };
  second.close();

  const failing = fakeSetup({ doctor: doctor(1), checkResult: { status: "failed", reason: "ran out of budget", subtype: "error_max_budget_usd", costUsd: 2.1, durationMs: 9000 } });
  const third = openSetupModal({ port: failing, readModel: async () => "sonnet" });
  await third.ready;
  await third.controller.check();
  await settle();
  const tq = (selector) => third.element.querySelector(selector);
  facts.error = { text: tq(".su-error").textContent, role: tq(".su-error").getAttribute("role"), head: tq(".su-run").textContent };
  third.close();

  document.getElementById("out").textContent = btoa(JSON.stringify(facts));
})().catch((e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + e.stack); });
`;

type Facts = {
  start: {
    lines: string[];
    estimate: string;
    foot: string[];
    callsAfterOpen: string[];
    insideScrim: boolean;
    paneFitsModal: boolean;
  };
  checking: { progress: string[]; foot: string[] };
  report: {
    nav: string[];
    head: string;
    changes: string[];
    checked: boolean[];
    badges: string[];
    commands: string[];
    applyDisabled: boolean;
    sameLeftEdge: boolean;
  };
  tests: {
    nav: string[];
    changes: string[];
    badges: string[];
    checked: boolean[];
  };
  afterTick: { nav: string[] };
  problemsAgain: { nav: string[] };
  applied: { text: string[]; foot: string[]; ran: string[] };
  empty: { text: string; applyDisabled: boolean; nav: string[] };
  error: { text: string; role: string; head: string };
};

function collect(): Facts {
  const dir = mkdtempSync(join(tmpdir(), "setup-modal-look-"));

  try {
    const bundle = buildSync({
      stdin: { contents: HARNESS, resolveDir: here("."), loader: "ts" },
      bundle: true,
      write: false,
      format: "iife",
      platform: "browser",
    }).outputFiles[0].text;
    const css = readFileSync(here("style.css"), "utf8");
    const page = join(dir, "page.html");

    writeFileSync(
      page,
      `<!doctype html><html><head><style>${css}${HIDE_SCROLLBARS}</style></head><body><div id="out"></div><script>${bundle.replaceAll("</script", "<\\/script")}</script></body></html>`,
    );

    const run = spawnSync(
      process.execPath,
      lookBrowserArgs(page, { size: "1200x800" }),
      { encoding: "utf8", timeout: 60000, maxBuffer: 16 * 1024 * 1024 },
    );
    const match = /<div id="out">([^<]*)<\/div>/.exec(run.stdout);

    if (match === null || !/^[A-Za-z0-9+/=]+$/.test(match[1])) {
      throw new Error(
        `no harness output: ${run.stderr.slice(0, 500)} ${run.error}`,
      );
    }

    const text = atob(match[1]);

    if (text.startsWith("ERR ")) {
      throw new Error(text);
    }

    return JSON.parse(text) as Facts;
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
  }
}

describe.skipIf(webkit === undefined)(
  "the setup modal in a real browser",
  () => {
    const f = (webkit === undefined ? null : collect()) as Facts;

    it("opens on doctor's result, says what Check does and gives the estimate, having run only doctor", () => {
      expect(f.start.lines).toEqual(["problem 0", "problem 1"]);
      expect(f.start.estimate).toContain("sonnet");
      expect(f.start.estimate).toContain("$0.26 to $1.04");
      expect(f.start.foot).toEqual(["Close", "Check with Claude"]);
      expect(f.start.callsAfterOpen).toEqual(["read_doctor"]);
    });

    it("fits the modal within the window and the pane within the modal", () => {
      expect(f.start.insideScrim).toBe(true);
      expect(f.start.paneFitsModal).toBe(true);
    });

    it("shows one progress line per tool use with Cancel while checking", () => {
      expect(f.checking.progress).toEqual([
        "Read .recognizer/policy.yaml",
        "Bash recognizer doctor",
      ]);
      expect(f.checking.foot).toEqual(["Cancel"]);
    });

    it("lays the report out with one nav entry per section, ticked-of-total counts and the run's time and cost", () => {
      expect(f.report.nav).toEqual([
        "Problems1 of 2",
        "Test suites0 of 1",
        "Policy0 of 1",
      ]);
      expect(f.report.head).toBe("1 min 23 s - $0.42");
      expect(f.report.changes).toEqual(["Drop key", "Add suite"]);
      expect(f.report.commands).toEqual([
        "recognizer config --unset a.b",
        "recognizer config tests.api.command pytest",
      ]);
      expect(f.report.sameLeftEdge).toBe(true);
    });

    it("starts a registers-a-program change unticked and badges it", () => {
      expect(f.report.checked).toEqual([true, false]);
      expect(f.report.badges).toEqual(["Registers a program"]);
      expect(f.report.applyDisabled).toBe(false);
    });

    it("badges a test-running change and starts it unticked, and ticking updates the nav count", () => {
      expect(f.tests.changes).toEqual(["Run the suites"]);
      expect(f.tests.badges).toEqual(["Runs the tests"]);
      expect(f.tests.checked).toEqual([false]);
      expect(f.afterTick.nav).toEqual([
        "Problems1 of 2",
        "Test suites1 of 1",
        "Policy0 of 1",
      ]);
    });

    it("applies exactly the ticked commands and reports them", () => {
      expect(f.applied.ran).toEqual([
        "recognizer config --unset a.b",
        "recognizer sensors check --run",
      ]);
      expect(f.applied.text[0]).toBe("2 of 2 applied.");
      expect(f.applied.foot).toEqual(["Back to the report", "Close"]);
    });

    it("shows Nothing to change with Apply disabled for an empty proposal", () => {
      expect(f.empty.text).toBe("Nothing to change");
      expect(f.empty.applyDisabled).toBe(true);
      expect(f.empty.nav).toEqual([]);
    });

    it("shows a failed check as an alert with its cost", () => {
      expect(f.error.text).toBe("ran out of budget");
      expect(f.error.role).toBe("alert");
      expect(f.error.head).toBe("9 s - $2.10");
    });
  },
);
