export class PlaceholderKey {
  private static readonly ANY = /<[a-z][a-z0-9_]*>/;
  private static readonly EACH = /<([a-z][a-z0-9_]*)>/g;

  constructor(private readonly text: string) {}

  static looksLikePlaceholder(text: string): boolean {
    return PlaceholderKey.ANY.test(text);
  }

  names(): string[] {
    return [...this.text.matchAll(PlaceholderKey.EACH)].map(
      (found) => found[1] ?? "",
    );
  }

  first(): string | undefined {
    return this.names()[0];
  }

  firstToken(): string | undefined {
    return PlaceholderKey.ANY.exec(this.text)?.[0];
  }
}
