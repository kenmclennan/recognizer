import { type Gap, outside } from "../../domain/gap.js";

export function findLanguageGaps(detected: string[]): Gap[] {
  return detected.length > 0
    ? []
    : [
        {
          id: "scanners:none-claims-files",
          line: "no installed scanner reads this repository's files",
          needs: ["scanner"],
          fix: outside(
            "run recognizer plugins to see what is installed; the README says how to get the official scanners",
          ),
        },
      ];
}
