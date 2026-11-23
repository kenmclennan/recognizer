import type { Repository } from "../../../domain/repository.js";
import type { ViewRepository } from "../../../domain/visualisation/view-repository.js";
import type { Git } from "../../shared/ports/git.js";
import type { Changes } from "../ports/changes.js";
import type { Windows } from "../ports/windows.js";

export interface VisualisationPorts {
  views: ViewRepository;
  git: Git;
  changes: Changes;
  windows: Windows;
  freshRepository(root: string): Repository;
}
