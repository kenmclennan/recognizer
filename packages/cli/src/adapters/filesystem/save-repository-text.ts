import type { Io } from "../../cli.js";

export function saveRepositoryText(io: Io, file: string, text: string): void {
  const temporary = `${file}.${io.pid()}.tmp`;

  io.writeFile(temporary, text);
  io.rename(temporary, file);
}
