export interface CurrentTests {
  digest(root: string): string | null;
}

export interface BaselineText {
  hash(root: string): string;
}
