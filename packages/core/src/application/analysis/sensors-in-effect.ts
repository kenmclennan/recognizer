export interface SensorsInEffect {
  sensorsInEffect(): { name: string; command: string[]; manifest: string[] }[];
}
