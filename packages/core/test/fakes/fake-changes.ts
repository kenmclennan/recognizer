import type {
  ChangeMarks,
  Changes,
  Repository,
  ViewChange,
} from "../../src/index.js";

export class FakeChanges implements Changes {
  result: ChangeMarks | null = { files: [], unmatched: 0 };
  lastBase: Repository | null | undefined;
  calls = 0;

  marks(
    _root: string,
    _change: ViewChange,
    _repository: Repository,
    base: Repository | null,
  ): ChangeMarks | null {
    this.calls += 1;
    this.lastBase = base;

    return this.result;
  }
}
