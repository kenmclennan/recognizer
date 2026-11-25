import type { Survey } from "../../domain/configuration/setup-survey.js";
import type { Repository } from "../../domain/repository.js";
import type {
  ConfigurationPorts,
  SetupDoctorReport,
} from "./internal/configuration-ports.js";
import { surveySetup } from "./survey-setup.js";

export type DoctorRead =
  | { status: "ok"; report: SetupDoctorReport }
  | { status: "unavailable"; reason: string };

export type SetupRead =
  | { status: "ok"; survey: Survey; doctor: DoctorRead }
  | { status: "unavailable"; reason: string };

export interface ReadSetupInput {
  root: string;
  extract: boolean;
  onLine: (line: string) => void;
  scan?: Repository;
}

function stepLine(step: string, state: string): string {
  return JSON.stringify({ event: "step", step, state });
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function languageLine(
  name: string,
  state: "reading" | "done",
  files: number | null,
): string {
  return JSON.stringify({ event: "language", name, state, files });
}

function extractPhaseLine(value: Record<string, unknown>): string | null {
  if (value.state === "current") {
    return JSON.stringify({ event: "extract-current" });
  }

  if (value.state !== "run") {
    return null;
  }

  const { languages } = value;
  const names =
    Array.isArray(languages) &&
    languages.every((one) => typeof one === "string" && one !== "")
      ? languages
      : null;

  return JSON.stringify({ event: "languages", names });
}

function pluginLanguageLine(value: Record<string, unknown>): string | null {
  const { name, data } = value;

  if (typeof name !== "string" || name === "" || !isRecord(data)) {
    return null;
  }

  const files =
    data.unit === "files" && isCount(data.total) ? data.total : null;

  if (data.event === "start") {
    return languageLine(name, "reading", files);
  }

  return data.event === "progress" && data.unit === "files"
    ? languageLine(name, "reading", files)
    : null;
}

function structureSetupLine(value: Record<string, unknown>): string | null {
  if (value.state === "run") {
    return JSON.stringify({
      event: "duplication",
      state: "comparing",
      files: null,
    });
  }

  return (value.state === "done" || value.state === "failed") &&
    isCount(value.files)
    ? JSON.stringify({
        event: "duplication",
        state: value.state,
        files: value.files,
      })
    : null;
}

export function setupLineOf(scanLine: string): string | null {
  let value: unknown;

  try {
    value = JSON.parse(scanLine);
  } catch {
    return null;
  }

  if (!isRecord(value)) {
    return null;
  }

  if (value.event === "phase" && value.phase === "extract") {
    return extractPhaseLine(value);
  }

  if (value.event === "plugin" && value.phase === "extract") {
    return pluginLanguageLine(value);
  }

  if (value.event === "entry" && value.phase === "extract") {
    return typeof value.name === "string" && value.name !== ""
      ? languageLine(value.name, "done", null)
      : null;
  }

  return value.event === "structure" ? structureSetupLine(value) : null;
}

function reasonOf(error: unknown): string {
  return (
    (error as { messages?: string[] }).messages?.join("; ") ??
    (error as Error).message
  );
}

export async function readSetup(
  ports: ConfigurationPorts,
  { root, extract, onLine, scan }: ReadSetupInput,
): Promise<SetupRead> {
  const survey = () =>
    surveySetup(ports, { root, ...(scan === undefined ? {} : { scan }) });

  onLine(stepLine("survey", "run"));

  let read: Survey;

  try {
    read = await survey();
  } catch (error) {
    return { status: "unavailable", reason: reasonOf(error) };
  }

  onLine(stepLine("survey", "done"));

  const scanned = extract && read.files === null;

  if (scanned) {
    onLine(stepLine("scan", "run"));

    const outcome = await ports.scan.extract(root, (scanLine) => {
      const translated = setupLineOf(scanLine);

      if (translated !== null) {
        onLine(translated);
      }
    });

    if (!outcome.ok) {
      return { status: "unavailable", reason: outcome.reason };
    }

    onLine(stepLine("scan", "done"));
  }

  onLine(stepLine("reading", "run"));

  if (scanned) {
    try {
      read = await survey();
    } catch (error) {
      return { status: "unavailable", reason: reasonOf(error) };
    }
  }

  let doctor: DoctorRead;

  try {
    doctor = { status: "ok", report: ports.reads.diagnose(root) };
  } catch (error) {
    doctor = { status: "unavailable", reason: reasonOf(error) };
  }

  onLine(stepLine("reading", "done"));

  return { status: "ok", survey: read, doctor };
}
