import { InvalidRequest } from "../../domain/invalid-request.js";
import { Neighbours } from "../../domain/neighbours.js";
import { ViewNotes } from "../../domain/visualisation/view-notes.js";
import { mutateView, type ViewMutation } from "./internal/mutate-view.js";
import { folderPath } from "./internal/view-access.js";
import { withNotes } from "./internal/view-checks.js";
import type { VisualisationPorts } from "./internal/visualisation-ports.js";

export interface NoteViewRequest {
  root: string;
  name: string | undefined;
  path: string;
  text: string | undefined;
  by: string | undefined;
  remove: boolean;
  after: string | undefined;
  first: boolean;
}

export function noteView(
  ports: VisualisationPorts,
  request: NoteViewRequest,
): ViewMutation {
  return mutateView(ports, request.root, request.name, (view, repository) => {
    const path = request.path;
    const notes = view.noteList();

    if (path.includes("#")) {
      throw new InvalidRequest([`notes stay at file level: ${path}`]);
    }

    const rawBy = request.by;

    if (request.remove) {
      const author = rawBy?.trim();
      const existing = notes.find((note) => note.module === path);

      if (existing === undefined) {
        throw new InvalidRequest([`no note on ${path}`]);
      }

      if (author !== undefined && existing.by !== author) {
        throw new InvalidRequest([
          `the note on ${path} is by ${existing.by}, not ${author}`,
        ]);
      }

      return {
        view: withNotes(
          view,
          notes.filter((note) => note.module !== path),
        ),
        what: `removed the note on ${path}`,
      };
    }

    const resolved = view.resolve(repository);
    const modules = [...resolved.modules, ...resolved.planned];

    if (path.endsWith("/")) {
      if (
        !modules.some((module) => Neighbours.under(module, folderPath(path)))
      ) {
        throw new InvalidRequest([`${path} has no file on the view`]);
      }
    } else if (!modules.includes(path)) {
      throw new InvalidRequest([`${path} is not on the view`]);
    }

    const text = (request.text as string).trim();
    const by = (rawBy ?? "agent").trim();

    if (text === "") {
      throw new InvalidRequest(["the note text must not be blank"]);
    }

    if (by === "" || by.length > 64) {
      throw new InvalidRequest([
        "--by must not be blank and is at most 64 characters",
      ]);
    }

    const entry = { module: path, text, by };
    const next =
      request.after !== undefined
        ? ViewNotes.placeNote(notes, entry, { after: request.after })
        : request.first
          ? ViewNotes.placeNote(notes, entry, "first")
          : ViewNotes.appendNote(notes, entry);

    return { view: withNotes(view, next), what: `set the note on ${path}` };
  });
}
