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

    const outcome = await ports.scan.extract(root, onLine);

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
