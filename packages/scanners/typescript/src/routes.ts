import type { FileInfo } from "./extract.js";

export interface Route {
  module: string;
  via: string[];
}

export type Locate = (module: string, specifier: string) => string | null;

export class Router {
  constructor(
    private readonly infos: Map<string, FileInfo>,
    private readonly locate: Locate,
  ) {}

  follow(module: string, name: string): Route[] {
    const routes = this.walk(module, name, [], new Set([`${module}\0${name}`]));

    return routes.length > 0 ? routes : [{ module, via: [] }];
  }

  private walk(
    module: string,
    name: string,
    via: string[],
    seen: Set<string>,
  ): Route[] {
    const info = this.infos.get(module);

    if (!info) {
      return [];
    }

    if (info.defined.has(name)) {
      return [{ module, via }];
    }

    const reexport = info.reexports.get(name);

    if (reexport) {
      const source = this.locate(module, reexport.specifier);

      if (source === null) {
        return [];
      }

      const key = `${source}\0${reexport.imported}`;

      if (seen.has(key)) {
        return [{ module, via }];
      }

      return this.walk(
        source,
        reexport.imported,
        [...via, module],
        new Set([...seen, key]),
      );
    }

    if (name === "default") {
      return [];
    }

    const routes: Route[] = [];

    for (const specifier of info.stars) {
      const source = this.locate(module, specifier);
      const key = `${source}\0${name}`;

      if (source !== null && !seen.has(key)) {
        routes.push(
          ...this.walk(source, name, [...via, module], new Set([...seen, key])),
        );
      }
    }

    return routes;
  }
}

export interface NamedEdge {
  to: string;
  names: string[];
  via: string[];
}

export function namedEdges(
  importer: string,
  target: string,
  names: string[],
  router: Router,
): NamedEdge[] {
  const grouped = new Map<string, NamedEdge>();

  for (const name of names) {
    for (const route of router.follow(target, name)) {
      if (route.module === importer) {
        continue;
      }

      let edge = grouped.get(route.module);

      if (!edge) {
        edge = { to: route.module, names: [], via: [] };
        grouped.set(route.module, edge);
      }

      if (!edge.names.includes(name)) {
        edge.names.push(name);
      }

      for (const step of route.via) {
        if (!edge.via.includes(step)) {
          edge.via.push(step);
        }
      }
    }
  }

  return [...grouped.values()];
}
