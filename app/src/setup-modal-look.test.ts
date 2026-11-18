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

const settle = () => new Promise((resolve) => setTimeout(resolve, 40));
const box = (node) => { const r = node.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; };
const facts = { screens: {}, lifecycle: {}, rowClicks: {} };

function prose(root) {
  const copy = root.cloneNode(true);
  for (const node of copy.querySelectorAll(".sw-mono, .sw-code, pre, code, textarea, input")) node.remove();
  return copy.textContent;
}

function snap(modal, name) {
  const q = (s) => modal.element.querySelector(s);
  const body = q(".sw-body");
  const dialog = q(".settings-modal");
  facts.screens[name] = {
    text: prose(body),
    heading: (q(".sw-body h2") || { textContent: "" }).textContent,
    steps: [...modal.element.querySelectorAll(".sw-step")].map((n) => n.dataset.step + (n.classList.contains("skip") ? ":skip" : n.classList.contains("now") ? ":now" : n.classList.contains("done") ? ":done" : "")),
    foot: [...modal.element.querySelectorAll(".sw-foot button")].filter((b) => !b.hidden).map((b) => b.textContent + (b.disabled ? " (disabled)" : "")),
    insideScrim: box(dialog).left >= box(modal.element).left && box(dialog).right <= box(modal.element).right && box(dialog).top >= box(modal.element).top && box(dialog).bottom <= box(modal.element).bottom,
    paneFitsModal: box(body).right <= box(dialog).right && box(body).bottom <= box(dialog).bottom,
    noHorizontalOverflow: body.scrollWidth <= body.clientWidth,
    rows: [...modal.element.querySelectorAll(".sw-row .sw-what")].map((n) => n.textContent),
    details: [...modal.element.querySelectorAll(".sw-row")].map((r) => { const pre = r.querySelector("pre"); const link = r.querySelector(".sw-link"); return pre ? { label: link.textContent, text: pre.textContent, hidden: pre.hidden } : null; }),
    cards: [...modal.element.querySelectorAll(".sw-rec .sw-what")].map((n) => n.textContent),
    groups: [...modal.element.querySelectorAll(".sw-group")].map((n) => n.textContent),
    env: [...modal.element.querySelectorAll(".sw-envrow code")].map((n) => n.textContent),
    runners: [...modal.element.querySelectorAll(".sw-runner")].map((n) => n.textContent),
    runnerOutputs: [...modal.element.querySelectorAll(".sw-runner")].map((n) => {
      const link = n.nextElementSibling;
      const box = link && link.nextElementSibling;
      return link && link.textContent === "Output" && box && box.tagName === "PRE" ? { hidden: box.hidden, text: box.textContent } : null;
    }),
  };
}

(async () => {
  let release = () => {};
  const fake = fakeSetup({ progress: ["Read 65 files and 212 imports"] });
  let closedCalls = 0;
  const modal = openSetupModal({ port: fake, onClose: () => { closedCalls += 1; } });
  facts.lifecycle.attachedOnOpen = document.body.contains(modal.element) && document.body.querySelectorAll(".setup-modal").length === 1;
  await modal.ready;
  await settle();
  const q = (s) => modal.element.querySelector(s);
  const qa = (s) => [...modal.element.querySelectorAll(s)];
  const next = () => { modal.controller.next(); return settle(); };

  snap(modal, "files");
  facts.openCalls = fake.calls.slice();
  await next();
  snap(modal, "checks");
  const plugin = q('[data-control^="plugin-"]');
  const pluginBefore = plugin.checked;
  plugin.closest(".sw-row").querySelector(".sw-why").click();
  await settle();
  facts.rowClicks.checkToggled = plugin.checked !== pluginBefore;
  facts.rowClicks.pointer = getComputedStyle(q('[data-control^="plugin-"]').closest(".sw-row")).cursor;
  plugin.closest(".sw-row").querySelector(".sw-why").click();
  await settle();
  facts.rowClicks.checkToggledBack = plugin.checked === pluginBefore;
  const analysis = q('[data-control="analysis"]');
  const limit = analysis.closest(".sw-row").querySelector(".sw-num");
  const analysisBefore = analysis.checked;
  limit.click();
  await settle();
  facts.rowClicks.limitKeptRow = analysis.checked === analysisBefore;
  await next();

  qa("button").find((b) => b.textContent === "Add a variable").click();
  await settle();
  q('[data-control="env-name"]').value = "RUST_LOG";
  q('[data-control="env-value"]').value = "debug";
  qa("button").find((b) => b.textContent === "Add").click();
  await settle();
  snap(modal, "tests");

  qa("button").find((b) => b.textContent === "Run once").click();
  await settle();
  await settle();
  snap(modal, "tests-tried");
  await next();

  q('[data-control="policy-ask"]').closest(".sw-row").querySelector(".sw-what").click();
  await settle();
  facts.rowClicks.policyAskByText = q('[data-control="policy-ask"]').checked && !q('[data-control="policy-skip"]').checked;
  q('[data-control="policy-skip"]').closest(".sw-row").querySelector(".sw-why").click();
  await settle();
  facts.rowClicks.policySkipByText = q('[data-control="policy-skip"]').checked && !q('[data-control="policy-ask"]').checked;
  q('[data-control="policy-ask"]').closest(".sw-row").querySelector(".sw-what").click();
  await settle();
  snap(modal, "policy-choice");
  fake.gate = new Promise((resolve) => { release = resolve; });
  qa("button").find((b) => b.textContent === "Ask Claude").click();
  await settle();
  snap(modal, "policy-running");
  facts.rowClicks.askButtonKeptRow = modal.controller.state().policyMode === "ask";
  release();
  fake.gate = null;
  await settle();
  await settle();
  snap(modal, "policy-cards");
  qa('[data-decide="0:accept"]')[0].click();
  await settle();
  await next();
  snap(modal, "review");

  fake.gate = new Promise((resolve) => { release = resolve; });
  qa("button").find((b) => b.textContent.startsWith("Apply")).click();
  await settle();
  snap(modal, "apply-running");
  release();
  fake.gate = null;
  await settle();
  await settle();
  snap(modal, "apply-done");
  modal.close();
  facts.lifecycle.goneAfterClose = document.querySelector(".setup-modal") === null;
  facts.lifecycle.closedCalls = closedCalls;

  const outputting = fakeSetup({ notReady: { tauri: "no report" }, notReadyOutput: { tauri: "engine not built" } });
  const third = openSetupModal({ port: outputting });
  await third.ready;
  for (let i = 0; i < 2; i++) { third.controller.next(); await settle(); }
  [...third.element.querySelectorAll("button")].find((b) => b.textContent === "Run once").click();
  await settle();
  await settle();
  snap(third, "tried-output");
  [...third.element.querySelectorAll(".sw-runner + button")][0].click();
  snap(third, "tried-output-open");
  third.close();

  const failing = fakeSetup({ failAt: 1 });
  const second = openSetupModal({ port: failing });
  await second.ready;
  for (let i = 0; i < 4; i++) second.controller.next();
  await settle();
  await second.controller.apply();
  await settle();
  snap(second, "apply-failed");
  second.close();

  let escCalls = 0;
  const esc = openSetupModal({ port: fakeSetup({}), onClose: () => { escCalls += 1; } });
  await esc.ready;
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  facts.lifecycle.escapeClosed = document.querySelector(".setup-modal") === null && escCalls === 1;

  let scrimCalls = 0;
  const sc = openSetupModal({ port: fakeSetup({}), onClose: () => { scrimCalls += 1; } });
  await sc.ready;
  sc.element.querySelector(".settings-modal").dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  facts.lifecycle.insideClickKept = document.querySelector(".setup-modal") !== null && scrimCalls === 0;
  sc.element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  facts.lifecycle.scrimClosed = document.querySelector(".setup-modal") === null && scrimCalls === 1;

  const live = fakeSetup({});
  const during = openSetupModal({ port: live });
  await during.ready;
  for (let i = 0; i < 4; i++) during.controller.next();
  await settle();
  live.gate = new Promise(() => {});
  const applying = during.controller.apply();
  await settle();
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  await settle();
  facts.lifecycle.stopCalls = live.calls.filter((c) => c === "stop_setup").length;
  facts.lifecycle.closedDuringApply = document.querySelector(".setup-modal") === null;

  const problemOf = (n) => ({ code: "config-retired", subject: "k" + n, title: "Settings moved to new places " + n, line: "config/sensors/thresholds was retired " + n, fix: { text: "Run the move " + n, command: "recognizer config --unset k" + n }, severity: "problem" });
  const reportOf = (count) => ({ repository: "/repo", ok: count === 0, problems: count, warnings: 0, areas: count === 0 ? [] : [{ name: "config", skipped: null, problems: Array.from({ length: count }, (_, i) => problemOf(i + 1)) }] });
  const upgradeSurvey = { ...fakeSetup({}).surveyRead.survey, configured: true, upgrade: [1, 2].map((n) => ({ code: "config-retired", subject: "k" + n, title: "Settings moved to new places " + n, line: "config/sensors/thresholds was retired " + n, command: "recognizer config --unset k" + n })) };
  const finals = { one: reportOf(1), two: reportOf(2), clean: reportOf(0), unavailable: null };
  for (const [name, doctor] of Object.entries(finals)) {
    const up = openSetupModal({ port: fakeSetup({ surveyRead: { status: "ok", survey: upgradeSurvey, doctor: { status: "ok", report: reportOf(2) } }, applyDoctor: doctor }) });
    await up.ready;
    await settle();
    if (name === "one") {
      snap(up, "upgrade-changes");
      up.element.querySelector(".sw-row .sw-link").click();
      snap(up, "upgrade-changes-open");
    }
    up.controller.next();
    await settle();
    if (name === "one") snap(up, "upgrade-review");
    await up.controller.apply();
    await settle();
    snap(up, "upgrade-final-" + name);
    up.close();
  }

  document.getElementById("out").textContent = btoa(unescape(encodeURIComponent(JSON.stringify(facts))));
})().catch((e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + e.stack); });
`;

type Screen = {
  text: string;
  heading: string;
  steps: string[];
  foot: string[];
  insideScrim: boolean;
  paneFitsModal: boolean;
  noHorizontalOverflow: boolean;
  rows: string[];
  details: ({ label: string; text: string; hidden: boolean } | null)[];
  cards: string[];
  groups: string[];
  env: string[];
  runners: string[];
  runnerOutputs: ({ hidden: boolean; text: string } | null)[];
};

type Facts = {
  rowClicks: {
    checkToggled: boolean;
    checkToggledBack: boolean;
    pointer: string;
    limitKeptRow: boolean;
    policyAskByText: boolean;
    policySkipByText: boolean;
    askButtonKeptRow: boolean;
  };
  screens: Record<string, Screen>;
  openCalls: string[];
  lifecycle: {
    attachedOnOpen: boolean;
    goneAfterClose: boolean;
    closedCalls: number;
    escapeClosed: boolean;
    insideClickKept: boolean;
    scrimClosed: boolean;
    stopCalls: number;
    closedDuringApply: boolean;
  };
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

    const text = Buffer.from(match[1], "base64").toString("utf8");

    if (text.startsWith("ERR ")) {
      throw new Error(text);
    }

    return JSON.parse(text) as Facts;
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
  }
}

describe.skipIf(webkit === undefined)(
  "the setup wizard in a real browser",
  () => {
    const f = (webkit === undefined ? null : collect()) as Facts;
    const names = [
      "files",
      "checks",
      "tests",
      "tests-tried",
      "policy-choice",
      "policy-running",
      "policy-cards",
      "review",
      "apply-running",
      "apply-done",
      "apply-failed",
    ];

    it("fits the modal within the window and the pane within the modal", () => {
      for (const name of names) {
        const screen = f.screens[name] as Screen;

        expect(screen.insideScrim, name).toBe(true);
        expect(screen.paneFitsModal, name).toBe(true);
        expect(screen.noHorizontalOverflow, name).toBe(true);
      }
    });

    it("attaches itself to the page on open and leaves it on close, as main.ts uses it", () => {
      expect(f.lifecycle.attachedOnOpen).toBe(true);
      expect(f.lifecycle.goneAfterClose).toBe(true);
      expect(f.lifecycle.closedCalls).toBe(1);
    });

    it("Escape closes the wizard and calls onClose", () => {
      expect(f.lifecycle.escapeClosed).toBe(true);
    });

    it("a click on the scrim closes the wizard and a click inside the dialog does not", () => {
      expect(f.lifecycle.insideClickKept).toBe(true);
      expect(f.lifecycle.scrimClosed).toBe(true);
    });

    it("clicking an option row's text selects or toggles its control and shows a pointer", () => {
      expect(f.rowClicks.checkToggled).toBe(true);
      expect(f.rowClicks.checkToggledBack).toBe(true);
      expect(f.rowClicks.pointer).toBe("pointer");
      expect(f.rowClicks.policyAskByText).toBe(true);
      expect(f.rowClicks.policySkipByText).toBe(true);
    });

    it("a click on a limit input or the Ask Claude button leaves the row's control unchanged", () => {
      expect(f.rowClicks.limitKeptRow).toBe(true);
      expect(f.rowClicks.askButtonKeptRow).toBe(true);
    });

    it("closing during Apply stops the run once", () => {
      expect(f.lifecycle.closedDuringApply).toBe(true);
      expect(f.lifecycle.stopCalls).toBe(1);
    });

    it("no screen carries a time estimate", () => {
      for (const name of names) {
        const screen = f.screens[name] as Screen;

        expect(screen.text.trim().length, name).toBeGreaterThan(0);
        expect(screen.text, name).not.toMatch(
          /\d\s?(s|sec|seconds?|min|minutes?)\b|about \d|longer than/,
        );
      }
    });

    it("shows files, checks and the tests step from the committed survey", () => {
      expect(f.openCalls).toEqual(["survey+extract"]);
      expect(f.screens.files?.rows).toEqual([
        "3 TypeScript files",
        "1 files not read",
      ]);
      expect(f.screens.files?.steps[0]).toBe("files:now");
      expect(f.screens.checks?.rows).toEqual([
        "Structure - always on",
        "Structural analysis",
        "C.R.A.P.",
        "Mutation",
      ]);
      expect(
        f.screens.tests?.rows.filter((row) => row.includes("found in")),
      ).toHaveLength(3);
      expect(f.screens.tests?.env).toEqual(["RUST_LOG", "debug"]);
    });

    it("shows Run once as a result per runner", () => {
      expect(f.screens["tests-tried"]?.runners).toEqual([
        "engine: ready",
        "app: ready",
        "tauri: ready",
      ]);
    });

    it("shows an Output disclosure only after a not-ready runner with output", () => {
      const closed = f.screens["tried-output"];

      expect(closed?.runners).toEqual([
        "engine: ready",
        "app: ready",
        "tauri: not ready - no report",
      ]);
      expect(closed?.runnerOutputs).toEqual([
        null,
        null,
        { hidden: true, text: "engine not built" },
      ]);
      expect(f.screens["tried-output-open"]?.runnerOutputs[2]?.hidden).toBe(
        false,
      );
      expect(f.screens["tests-tried"]?.runnerOutputs).toEqual([
        null,
        null,
        null,
      ]);
    });

    it("shows the policy choice, the running state and the two groups of cards", () => {
      expect(f.screens["policy-choice"]?.foot).toContain("Next (disabled)");
      expect(f.screens["policy-running"]?.text).toContain(
        "Claude is reading the imports",
      );
      expect(f.screens["policy-cards"]?.groups).toEqual(["Left out", "Rules"]);
      expect(f.screens["policy-cards"]?.cards).toHaveLength(4);
    });

    it("upgrade rows show titles", () => {
      for (const name of ["upgrade-changes", "upgrade-review"]) {
        const screen = f.screens[name] as Screen;

        expect(screen.rows, name).toHaveLength(2);
        expect(screen.rows[0], name).toBe("Settings moved to new places 1");
        expect(screen.text, name).not.toContain("thresholds");
        expect(screen.details[0]?.label, name).toBe("Details");
        expect(screen.details[0]?.text, name).toBe(
          "config/sensors/thresholds was retired 1\n\nrecognizer config --unset k1",
        );
      }

      expect(f.screens["upgrade-changes"]?.details[0]?.hidden).toBe(true);
      expect(f.screens["upgrade-changes-open"]?.details[0]?.hidden).toBe(false);
    });

    it("final screen lists what is left", () => {
      const final = (name: string) =>
        f.screens[`upgrade-final-${name}`] as Screen;

      expect(final("one").heading).toBe("Updated - 1 thing still to fix");
      expect(final("one").text).toContain("Settings moved to new places 1");
      expect(final("one").text).toContain("Run the move 1");
      expect(final("two").heading).toBe("Updated - 2 things still to fix");
      expect(final("two").text).toContain("Settings moved to new places 2");
      expect(final("clean").heading).toBe("Everything is up to date");
      expect(final("clean").text).not.toContain("Run the move");
      expect(final("unavailable").heading).toBe("Updated");
      expect(final("unavailable").text).toContain("Doctor could not run.");
    });

    it("lists the changes in review and shows apply running, done and failed", () => {
      expect(
        f.screens.review?.foot.some((label) => label.startsWith("Apply ")),
      ).toBe(true);
      expect(f.screens["apply-running"]?.foot).toContain("Stop");
      expect(f.screens["apply-done"]?.heading).toBe("Setup is done");
      expect(f.screens["apply-done"]?.foot).toContain("Close");
      expect(f.screens["apply-failed"]?.heading).toBe("Setup stopped");
      expect(f.screens["apply-failed"]?.foot).toContain("Try again");
      expect(f.screens["apply-failed"]?.foot).toContain("Back to review");
    });
  },
);
