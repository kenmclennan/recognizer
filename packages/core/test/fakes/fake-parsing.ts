import type { Parsers, Parsing } from "../../src/index.js";

export class FakeParsing implements Parsing {
  readonly loaded: (readonly string[])[] = [];
  parsers: Parsers = new Map();

  loadParsers(languages: readonly string[]): Promise<Parsers> {
    this.loaded.push(languages);

    return Promise.resolve(this.parsers);
  }
}
