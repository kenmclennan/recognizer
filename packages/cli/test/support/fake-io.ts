import type { Io, Running, RunOptions } from "../../src/cli.js";
import { StopScope } from "../../src/stop-scope.js";
import { FakeFiles } from "./io/files.js";
import { FakeProcesses, type Program } from "./io/processes.js";
import { FakeTimers } from "./io/timers.js";

export const FAKE_BIN = "/fake-bin";

export interface FakeIoOptions {
  files?: FakeFiles;
  programs?: Record<string, Program>;
  env?: Record<string, string>;
}

export class FakeIo implements Io {
  readonly files: FakeFiles;
  readonly timers: FakeTimers;
  readonly processes: FakeProcesses;
  readonly scope: StopScope = new StopScope(false, (ms, action) =>
    this.timers.after(ms, action),
  );
  readonly out: string[] = [];
  readonly err: string[] = [];
  readonly environment: Record<string, string>;
  readonly alive = new Set<number>();
  readonly groups = new Map<number, number>();
  processId = 4242;

  constructor(options: FakeIoOptions = {}) {
    this.files = options.files ?? new FakeFiles();
    this.timers = new FakeTimers();
    this.processes = new FakeProcesses(this.files, this.timers);
    this.environment = { PATH: FAKE_BIN, ...options.env };

    for (const [name, program] of Object.entries(options.programs ?? {})) {
      this.install(name, program);
    }
  }

  install(name: string, program: Program): void {
    this.processes.register(name, program);
    this.files.writeFile(`${FAKE_BIN}/${name}`, "", 0o755);
  }

  exists = (path: string) => this.files.exists(path);
  readFile = (path: string) => this.files.readFile(path);
  readBytes = (path: string) => this.files.readBytes(path);
  hashFile = (path: string) => this.files.hashFile(path);
  writeFile = (path: string, content: string, mode?: number) =>
    this.files.writeFile(path, content, mode);
  rename = (from: string, to: string) => this.files.rename(from, to);
  readDir = (path: string) => this.files.readDir(path);
  remove = (path: string) => this.files.remove(path);
  makeTempDir = () => this.files.makeTempDir();
  removeDir = (path: string) => this.files.removeDir(path);
  modified = (path: string) => this.files.modified(path);
  createExclusive = (path: string, content: string) =>
    this.files.createExclusive(path, content);
  append = (path: string, content: string) => this.files.append(path, content);
  stamp = (path: string) => this.files.stamp(path);

  run: Io["run"] = (command, args, options) =>
    this.processes.run(command, args, options);
  runAsync(command: string, args: string[], options?: RunOptions): Running {
    return this.processes.runAsync(command, args, options, this.scope);
  }

  withScope(scope: StopScope): FakeIo {
    return Object.create(this, { scope: { value: scope } }) as FakeIo;
  }

  launch: Io["launch"] = (command, args) =>
    this.processes.launch(command, args);
  request: Io["request"] = (socket, text) =>
    this.processes.request(socket, text);

  now = () => this.timers.now();
  awake = () => this.timers.awake();
  after = (ms: number, action: () => void) => this.timers.after(ms, action);
  wait = (ms: number) => this.timers.wait(ms);

  readStdin = () => "";
  readLine = (): Promise<string | null> => Promise.resolve(null);
  env = (name: string) => this.environment[name];
  pid = () => this.processId;
  pidAlive = (pid: number) => this.alive.has(pid);
  processGroup = (pid: number) => this.groups.get(pid) ?? null;
  stdout = (text: string) => {
    this.out.push(text);
  };
  stderr = (text: string) => {
    this.err.push(text);
  };
}
