import { InvalidRequest } from "../../domain/invalid-request.js";
import { ViewNotes } from "../../domain/visualisation/view-notes.js";
import { mutateView, type ViewMutation } from "./internal/mutate-view.js";
import { withNotes } from "./internal/view-checks.js";
import type { VisualisationPorts } from "./internal/visualisation-ports.js";

export interface ReorderViewNotesRequest {
  root: string;
  name: string | undefined;
  paths: string[];
}

export function reorderViewNotes(
  ports: VisualisationPorts,
  request: ReorderViewNotesRequest,
): ViewMutation {
  return mutateView(ports, request.root, request.name, (view) => {
    const notes = view.noteList();

    if (notes.length === 0) {
      throw new InvalidRequest(["no notes to reorder"]);
    }

    return {
      view: withNotes(view, ViewNotes.reorderNotes(notes, request.paths)),
      what: "reordered the notes",
    };
  });
}
