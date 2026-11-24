import type { FileKind } from "../file.js";
import type { Member } from "../member.js";
import { type NeighbourRow, Neighbours } from "../neighbours.js";
import type { Repository } from "../repository.js";

export class DescribeRequest {
  constructor(
    readonly id: string,
    readonly kind: FileKind,
    readonly files: readonly string[],
    readonly source: string,
    readonly members: readonly Member[],
    readonly uses: readonly NeighbourRow[],
    readonly usedBy: readonly NeighbourRow[],
  ) {}

  static of(
    repository: Repository,
    ids: string[],
    id: string,
    files: readonly string[],
    source: string,
  ): DescribeRequest {
    const file = repository.file(id);
    const neighbours = new Neighbours(repository, ids);

    return new DescribeRequest(
      id,
      file === undefined ? "source" : file.kind,
      files,
      source,
      file?.members ?? [],
      neighbours.usesOf(id),
      neighbours.usedByOf(id),
    );
  }
}
