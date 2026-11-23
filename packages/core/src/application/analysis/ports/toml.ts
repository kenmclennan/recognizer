export interface Toml {
  parse(text: string): Record<string, unknown> | null;
}
