export interface TestReports {
  entries(root: string): Map<string, string> | null;
}
