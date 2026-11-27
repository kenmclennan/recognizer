import { serializeRegistration } from "@recognizer/core";
import { describe, expect, it } from "vitest";
import { cliScenario } from "./support/cli-scenario.js";
import { scannerManifestText } from "./support/manifest-text.js";
import { sensorManifest } from "./support/sensor-program.js";

type Listed = { kind: string; name: string }[];

function registerOffPath(
  scenario: ReturnType<typeof cliScenario>,
  kind: "scanner" | "sensor",
  name: string,
  manifest: string,
): void {
  const { io } = scenario.root;
  const program = `recognizer-${kind === "scanner" ? "scan" : "sense"}-${name}`;
  const command = [`/registered/${program}`];

  io.environment.RECOGNIZER_PLUGIN_DIRS = "/plugins/brew:/plugins/user";
  io.processes.register(program, (call) => ({
    started: true,
    status: 0,
    stdout: call.args.join(" ") === "manifest" ? manifest : "",
    stderr: "",
  }));
  io.files.writeFile(command[0] as string, "", 0o755);
  io.files.writeFile(
    `/plugins/user/${kind}-${name}.json`,
    serializeRegistration({
      kind,
      name,
      command,
      manifest: [...command, "manifest"],
    }),
  );
}

async function listed(
  scenario: ReturnType<typeof cliScenario>,
): Promise<Listed> {
  const result = await scenario.run(["plugins", "--json", scenario.repository]);

  expect(result.exit).toBe(0);

  const parsed = JSON.parse(result.out) as Listed;

  return parsed;
}

describe("plugins registered outside PATH", () => {
  it("lists a registered scanner that is not on PATH", async () => {
    const scenario = cliScenario();

    registerOffPath(
      scenario,
      "scanner",
      "elsewhere",
      scannerManifestText("elsewhere"),
    );

    expect(
      (await listed(scenario)).filter((one) => one.kind === "scanner"),
    ).toContainEqual(expect.objectContaining({ name: "elsewhere" }));
  });

  it("lists a registered sensor that is not on PATH", async () => {
    const scenario = cliScenario();

    registerOffPath(
      scenario,
      "sensor",
      "elsewhere",
      sensorManifest("elsewhere"),
    );

    expect(
      (await listed(scenario)).filter((one) => one.kind === "sensor"),
    ).toContainEqual(expect.objectContaining({ name: "elsewhere" }));
  });

  it("still lists an unregistered sensor on PATH", async () => {
    const scenario = cliScenario({ sensors: ["onpath"] });

    expect(
      (await listed(scenario)).filter((one) => one.kind === "sensor"),
    ).toContainEqual(expect.objectContaining({ name: "onpath" }));
  });
});
