import type { FileInfo, TypeDecl } from "./extract.js";
import type { Router } from "./routes.js";

export const GENERIC_METHODS: ReadonlySet<string> = new Set(
  `get set has add delete remove pop push append extend insert clear copy update
keys values items entries close open read write run call apply start stop join
split map filter forEach reduce find includes indexOf slice then catch finally
toString toJSON format strip count index sort reverse encode decode load dump
loads dumps send emit on off`.split(/\s+/),
);

export const MAX_CLASSES = 4;

export interface InferredEdge {
  to: string;
  line: number;
  names: string[];
  inferred: {
    parameter: string;
    methods: string[];
    class: string;
    implementations: string[];
  };
}

export interface Candidate {
  module: string;
  decl: TypeDecl;
  bases: string[];
  direct: string[];
}

const keyOf = (module: string, name: string) => `${module}\0${name}`;

export class Inference {
  private readonly candidates = new Map<string, Candidate>();

  constructor(
    private readonly infos: Map<string, FileInfo>,
    private readonly router: Router,
    private readonly locate: (
      module: string,
      specifier: string,
    ) => string | null,
  ) {
    for (const [module, info] of infos) {
      for (const decl of info.types) {
        this.candidates.set(keyOf(module, decl.name), {
          module,
          decl,
          bases: [],
          direct: [],
        });
      }
    }

    for (const candidate of this.candidates.values()) {
      const info = infos.get(candidate.module);

      if (!info) {
        continue;
      }

      const resolve = (refs: TypeDecl["extendsList"]) =>
        refs.flatMap((ref) => this.resolveRef(candidate.module, info, ref));

      candidate.bases = resolve(candidate.decl.extendsList);
      candidate.direct = [
        ...candidate.bases,
        ...resolve(candidate.decl.implementsList),
      ];
    }
  }

  private resolveRef(
    module: string,
    info: FileInfo,
    ref: TypeDecl["extendsList"][number],
  ): string[] {
    const local = this.candidates.get(keyOf(module, ref.local));

    if (local && ref.property === null) {
      return [keyOf(module, ref.local)];
    }

    const binding = info.bindings.get(ref.local);

    if (!binding) {
      return [];
    }

    const target = this.locate(module, binding.specifier);

    if (target === null) {
      return [];
    }

    let name: string | null = null;

    if (binding.form === "namespace") {
      name = ref.property;
    } else if (ref.property === null) {
      name = binding.imported;
    }

    if (name === null) {
      return [];
    }

    const found = this.router.follow(target, name)[0];

    if (!found) {
      return [];
    }

    const declared =
      name === "default"
        ? (this.infos.get(found.module)?.defaultName ?? name)
        : name;

    return this.candidates.has(keyOf(found.module, declared))
      ? [keyOf(found.module, declared)]
      : [];
  }

  private methodsOf(key: string, seen = new Set<string>()): Set<string> {
    const candidate = this.candidates.get(key);

    if (!candidate || seen.has(key)) {
      return new Set();
    }

    seen.add(key);
    const methods = new Set(candidate.decl.methods);

    for (const base of candidate.bases) {
      for (const method of this.methodsOf(base, seen)) {
        methods.add(method);
      }
    }

    return methods;
  }

  matchesFor(called: readonly string[]): [string, Candidate][] {
    if (
      called.length === 0 ||
      called.every((method) => GENERIC_METHODS.has(method))
    ) {
      return [];
    }

    const matches = [...this.candidates.entries()].filter(([key]) => {
      const methods = this.methodsOf(key);

      return called.every((method) => methods.has(method));
    });
    const abstract = matches.filter(([, c]) => c.decl.abstract);
    const kept = abstract.length > 0 ? abstract : matches;

    return kept.length > MAX_CLASSES ? [] : kept;
  }

  definerOf(
    key: string,
    method: string,
    seen = new Set<string>(),
  ): Candidate | null {
    const candidate = this.candidates.get(key);

    if (!candidate || seen.has(key)) {
      return null;
    }

    seen.add(key);

    if (candidate.decl.methods.has(method)) {
      return candidate;
    }

    for (const base of candidate.bases) {
      const found = this.definerOf(base, method, seen);

      if (found) {
        return found;
      }
    }

    return null;
  }

  edgesFor(info: FileInfo): InferredEdge[] {
    const edges: InferredEdge[] = [];

    for (const use of info.parameters) {
      const kept = this.matchesFor([...use.methods]);

      if (kept.length === 0) {
        continue;
      }

      const methods = [...use.methods].sort((a, b) =>
        a < b ? -1 : a > b ? 1 : 0,
      );

      for (const [key, candidate] of kept) {
        const implementations = [
          ...new Set(
            [...this.candidates.values()]
              .filter((other) => other.direct.includes(key))
              .map((other) => other.decl.name),
          ),
        ].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

        edges.push({
          to: candidate.module,
          line: use.line,
          names: methods,
          inferred: {
            parameter: use.parameter,
            methods,
            class: candidate.decl.name,
            implementations,
          },
        });
      }
    }

    return edges;
  }
}
