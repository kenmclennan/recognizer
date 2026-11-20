import type {
  ApplyEvent,
  DoctorReport,
  Recommendation,
  SetupChoices,
  Survey,
  TryEvent,
} from "recognizer";

export type DoctorRead =
  | { status: "ok"; report: DoctorReport }
  | { status: "unavailable"; reason: string };

export type SetupSurveyRead =
  | { status: "ok"; survey: Survey; doctor: DoctorRead }
  | { status: "unavailable"; reason: string };

export type RecommendRead =
  | {
      status: "proposal";
      output: Recommendation;
      costUsd: number | null;
      durationMs: number | null;
      denials: number;
    }
  | {
      status: "failed";
      reason: string;
      subtype: string | null;
      costUsd: number | null;
      durationMs: number | null;
    }
  | { status: "cancelled" }
  | { status: "refused"; reason: string }
  | { status: "unavailable"; reason: string };

export type ApplyResultEvent = Extract<ApplyEvent, { event: "result" }>;

export type TryResultEvent = Extract<TryEvent, { event: "result" }>;

export type SetupPort = {
  survey(
    extract: boolean,
    onLine: (line: string) => void,
  ): Promise<SetupSurveyRead>;
  recommend(
    prompt: string,
    schema: unknown,
    onLine: (line: string) => void,
  ): Promise<RecommendRead>;
  apply(
    choices: SetupChoices,
    onEvent: (event: ApplyEvent) => void,
  ): Promise<ApplyResultEvent>;
  tryRunners(
    choices: SetupChoices,
    onEvent: (event: TryEvent) => void,
  ): Promise<TryResultEvent>;
  stop(): Promise<void>;
};
