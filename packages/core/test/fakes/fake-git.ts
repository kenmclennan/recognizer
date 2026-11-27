import {
  type Git,
  type GitText,
  type NameStatusEntry,
  ViewRange,
  type WorkingTreeEntry,
} from "../../src/index.js";

export class FakeGit implements Git {
  readonly refs = new Map<string, string>();
  readonly ancestors = new Set<string>();
  readonly renames = new Map<string, Map<string, string>>();
  readonly diffs = new Map<string, readonly NameStatusEntry[]>();
  readonly texts = new Map<string, string>();
  readonly archives = new Map<string, readonly string[]>();
  readonly calls: string[] = [];
  user: string | null = null;
  inside = true;
  branchName: string | null = null;
  files: readonly string[] = [];
  defaultRefName: string | null = null;
  historyText: GitText = { ok: true, text: "" };
  branchesText: GitText = { ok: true, text: "" };
  branchTotal: number | null = null;
  readonly mergeBases = new Map<string, string>();
  readonly aheadBehinds = new Map<string, { behind: number; ahead: number }>();
  readonly refDiffs = new Map<string, readonly NameStatusEntry[]>();
  readonly commitDetails = new Map<string, string>();
  readonly tipSummaries = new Map<string, string>();
  state: string | null = "state-0";
  dirtyList: readonly string[] | null | undefined = undefined;

  constructor(
    private readonly head: string | null,
    public modified = false,
  ) {}

  commit(): string | null {
    return this.head;
  }

  dirty(): boolean {
    return this.modified;
  }

  dirtyPaths(): readonly string[] | null {
    if (this.dirtyList !== undefined) {
      return this.dirtyList;
    }

    return this.modified ? null : [];
  }

  resolveRef(_root: string, ref: string): string | null {
    this.calls.push(`resolveRef ${ref}`);

    if (!ViewRange.isValidRef(ref)) {
      return null;
    }

    return this.refs.get(ref) ?? null;
  }

  isAncestor(_root: string, ancestor: string, descendant: string): boolean {
    this.calls.push(`isAncestor ${ancestor} ${descendant}`);

    return (
      ancestor === descendant || this.ancestors.has(`${ancestor}>${descendant}`)
    );
  }

  renamesSince(_root: string, commit: string): ReadonlyMap<string, string> {
    this.calls.push(`renamesSince ${commit}`);

    return this.renames.get(commit) ?? new Map<string, string>();
  }

  nameStatus(
    _root: string,
    base: string,
    head: string,
  ): readonly NameStatusEntry[] | null {
    this.calls.push(`nameStatus ${base} ${head}`);

    return this.diffs.get(`${base}...${head}`) ?? null;
  }

  userName(): string | null {
    return this.user;
  }

  async showText(
    _root: string,
    commit: string,
    path: string,
    limit: number,
  ): Promise<string | null> {
    const text = this.texts.get(`${commit}:${path}`);

    return text === undefined || Buffer.byteLength(text) > limit ? null : text;
  }

  async archive(
    _root: string,
    commit: string,
    paths: readonly string[],
    _target: string,
  ): Promise<boolean> {
    this.calls.push(`archive ${commit}`);

    if (!this.archives.has(commit)) {
      return false;
    }

    this.archived.push({ commit, paths });

    return true;
  }

  readonly archived: { commit: string; paths: readonly string[] }[] = [];

  branch(): string | null {
    return this.inside ? this.branchName : null;
  }

  insideWorkTree(): boolean {
    return this.inside;
  }

  listFiles(): readonly string[] | null {
    return this.inside ? this.files : null;
  }

  defaultRef(): string | null {
    return this.defaultRefName !== null &&
      ViewRange.isValidRef(this.defaultRefName)
      ? this.defaultRefName
      : null;
  }

  async history(_root: string, limit: number): Promise<GitText> {
    this.calls.push(`history ${limit}`);

    return this.inside
      ? this.historyText
      : { ok: false, error: "not a git repository" };
  }

  async branches(_root: string, limit: number): Promise<GitText> {
    this.calls.push(`branches ${limit}`);

    return this.inside
      ? this.branchesText
      : { ok: false, error: "not a git repository" };
  }

  async branchCount(): Promise<number | null> {
    return this.inside ? this.branchTotal : null;
  }

  async mergeBase(_root: string, a: string, b: string): Promise<string | null> {
    this.calls.push(`mergeBase ${a} ${b}`);

    return this.mergeBases.get(`${a}...${b}`) ?? null;
  }

  async aheadBehind(
    _root: string,
    base: string,
    head: string,
  ): Promise<{ behind: number; ahead: number } | null> {
    this.calls.push(`aheadBehind ${base} ${head}`);

    return this.aheadBehinds.get(`${base}...${head}`) ?? null;
  }

  async diffRefs(
    _root: string,
    base: string,
    head: string,
  ): Promise<readonly NameStatusEntry[] | null> {
    this.calls.push(`diffRefs ${base} ${head}`);

    return this.refDiffs.get(`${base}...${head}`) ?? null;
  }

  async commitDetail(_root: string, ref: string): Promise<string | null> {
    this.calls.push(`commitDetail ${ref}`);

    return ViewRange.isValidRef(ref)
      ? (this.commitDetails.get(ref) ?? null)
      : null;
  }

  async tipSummary(_root: string, ref: string): Promise<string | null> {
    this.calls.push(`tipSummary ${ref}`);

    return ViewRange.isValidRef(ref)
      ? (this.tipSummaries.get(ref) ?? null)
      : null;
  }

  workingTreeEntries: readonly WorkingTreeEntry[] | null = [];

  async workingTree(): Promise<readonly WorkingTreeEntry[] | null> {
    return this.inside ? this.workingTreeEntries : null;
  }

  async stateSnapshot(): Promise<string | null> {
    return this.inside ? this.state : null;
  }
}
