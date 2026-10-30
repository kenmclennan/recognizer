export const TOOLCHAIN_WORKSPACES = ["check", "scanners/typescript"];

function resolve(packages, fromPath, name) {
  let base = fromPath;

  for (;;) {
    const candidate =
      base === "" ? `node_modules/${name}` : `${base}/node_modules/${name}`;

    if (packages[candidate]) {
      return candidate;
    }

    if (base === "") {
      return undefined;
    }

    const cut = base.lastIndexOf("/node_modules/");
    base = cut === -1 ? "" : base.slice(0, cut);
  }
}

export function closureFromLock(lock, workspaces = TOOLCHAIN_WORKSPACES) {
  const found = new Map();
  const pending = workspaces.map((path) => ({
    path,
    entry: lock.packages[path],
  }));

  for (const { path, entry } of pending) {
    if (!entry) {
      throw new Error(`workspace ${path} has no entry in the lockfile`);
    }
  }

  while (pending.length > 0) {
    const { path, entry } = pending.pop();

    for (const name of Object.keys(entry.dependencies ?? {})) {
      const resolved = resolve(lock.packages, path, name);

      if (resolved === undefined) {
        throw new Error(
          `dependency ${name} of ${path} resolves to no lockfile entry`,
        );
      }

      const target = lock.packages[resolved];

      if (target.link || found.has(resolved)) {
        continue;
      }

      found.set(resolved, target.version);
      pending.push({ path: resolved, entry: target });
    }
  }

  return new Map([...found].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

export function verifyVendored(
  lock,
  versionsByPath,
  workspaces = TOOLCHAIN_WORKSPACES,
) {
  const expected = closureFromLock(lock, workspaces);
  const problems = [];

  for (const [path, version] of expected) {
    const actual = versionsByPath[path];

    if (actual === undefined) {
      problems.push(`${path} is missing (lockfile ${version})`);
    } else if (actual !== version) {
      problems.push(`${path} is ${actual}, lockfile has ${version}`);
    }
  }

  for (const path of Object.keys(versionsByPath)) {
    if (!expected.has(path) && versionsByPath[path] !== undefined) {
      problems.push(`${path} is not in the lockfile's production closure`);
    }
  }

  if (problems.length > 0) {
    throw new Error(
      `vendored dependencies differ from package-lock.json: ${problems.join("; ")}`,
    );
  }
}
