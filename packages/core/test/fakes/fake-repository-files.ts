import {
  type RepositoryFiles,
  type RepositoryListing,
  type RepositoryListingRequest,
  SKIPPED_DIRECTORIES,
} from "../../src/index.js";
import type { FakeSetupFiles } from "./fake-setup-files.js";

const OWN_STATE = ".recognizer";

export class FakeRepositoryFiles implements RepositoryFiles {
  readonly calls: string[] = [];
  listed: string[] | null = null;
  gitless = false;
  warning: string | null = null;

  constructor(private readonly setup: FakeSetupFiles) {}

  list(root: string, request: RepositoryListingRequest): RepositoryListing {
    this.calls.push("list");

    const prefix = root.endsWith("/") ? root : `${root}/`;
    const seeded = [...this.setup.files.keys()]
      .filter((path) => path.startsWith(prefix))
      .map((path) => path.slice(prefix.length))
      .sort();

    if (this.gitless) {
      return this.unlisted(request, seeded);
    }

    const paths = this.listed ?? (seeded.length > 0 ? seeded : null);

    if (paths === null) {
      return this.unlisted(request, seeded);
    }

    return {
      from: "git",
      paths: paths
        .filter(
          (path) =>
            !request.excludeOwnState ||
            (path !== OWN_STATE && !path.startsWith(`${OWN_STATE}/`)),
        )
        .filter(
          (path) =>
            !request.onlyPresent || this.setup.files.has(`${prefix}${path}`),
        ),
    };
  }

  private unlisted(
    request: RepositoryListingRequest,
    seeded: string[],
  ): RepositoryListing {
    if (request.fallback === "none") {
      return { from: "none", warning: this.warning };
    }

    if (seeded.length === 0) {
      return { from: "none", warning: null };
    }

    return {
      from: "walk",
      paths: seeded.filter(
        (path) =>
          !path
            .split("/")
            .slice(0, -1)
            .some((part) => SKIPPED_DIRECTORIES.has(part)),
      ),
    };
  }
}
