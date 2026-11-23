import type { Repository } from "../../../domain/repository.js";
import type { ViewChange } from "../../../domain/visualisation/view.js";

export interface ChangedFile {
  id: string;
  mark: string;
  box: string;
  from?: string;
}

export interface ChangeMarks {
  files: ChangedFile[];
  unmatched: number;
}

export interface Changes {
  marks(
    root: string,
    change: ViewChange,
    repository: Repository,
    base: Repository | null,
  ): ChangeMarks | null;
}
