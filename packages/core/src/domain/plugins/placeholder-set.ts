import { type PlaceholderDeclaration, placeholderPattern } from "./manifest.js";

export class PlaceholderSet {
  constructor(
    private readonly declared: Record<string, PlaceholderDeclaration> = {},
  ) {}

  names(): string[] {
    return Object.keys(this.declared);
  }

  has(name: string): boolean {
    return this.declared[name] !== undefined;
  }

  pattern(name: string): RegExp | null {
    const declaration = this.declared[name];

    return declaration === undefined
      ? null
      : PlaceholderSet.compile(declaration);
  }

  uncompilable(): string[] {
    return Object.entries(this.declared)
      .filter(
        ([, declaration]) =>
          declaration.pattern !== undefined &&
          PlaceholderSet.compile(declaration) === null,
      )
      .map(([name]) => name);
  }

  private static compile(declaration: PlaceholderDeclaration): RegExp | null {
    try {
      return new RegExp(placeholderPattern(declaration));
    } catch {
      return null;
    }
  }
}
