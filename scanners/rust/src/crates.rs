use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::fs;
use std::path::Path;

use toml::{Table, Value};

pub struct Package {
    pub dir: String,
    pub lib_name: String,
    pub lib_root: Option<String>,
    pub roots: Vec<String>,
    pub in_repo: BTreeMap<String, String>,
    pub foreign: BTreeSet<String>,
}

pub fn normalize(path: &str) -> Option<String> {
    let mut parts: Vec<&str> = Vec::new();

    for part in path.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop()?;
            }
            other => parts.push(other),
        }
    }

    Some(parts.join("/"))
}

pub fn join(directory: &str, relative: &str) -> Option<String> {
    if directory.is_empty() {
        normalize(relative)
    } else {
        normalize(&format!("{directory}/{relative}"))
    }
}

pub fn directory_of(path: &str) -> &str {
    path.rsplit_once('/').map_or("", |(directory, _)| directory)
}

struct Manifest {
    dir: String,
    table: Table,
}

fn use_name(key: &str) -> String {
    key.replace('-', "_")
}

fn string_at<'a>(table: &'a Table, keys: &[&str]) -> Option<&'a str> {
    let mut current = table;

    for key in &keys[..keys.len() - 1] {
        current = current.get(*key)?.as_table()?;
    }

    current.get(keys[keys.len() - 1])?.as_str()
}

fn dependency_tables(table: &Table) -> Vec<&Table> {
    const NAMES: [&str; 3] = ["dependencies", "dev-dependencies", "build-dependencies"];

    let mut found: Vec<&Table> = NAMES
        .iter()
        .filter_map(|name| table.get(*name)?.as_table())
        .collect();

    if let Some(targets) = table.get("target").and_then(Value::as_table) {
        for target in targets.values().filter_map(Value::as_table) {
            found.extend(
                NAMES
                    .iter()
                    .filter_map(|name| target.get(*name)?.as_table()),
            );
        }
    }

    found
}

pub fn read_packages(
    root: &Path,
    manifest_paths: &[String],
    source_files: &HashSet<String>,
) -> Vec<Package> {
    let manifests: Vec<Manifest> = manifest_paths
        .iter()
        .filter_map(|path| {
            let text = fs::read_to_string(root.join(path)).ok()?;
            let table = text.parse::<Table>().ok()?;

            Some(Manifest {
                dir: directory_of(path).to_string(),
                table,
            })
        })
        .collect();

    let package_dirs: HashSet<&str> = manifests
        .iter()
        .filter(|m| string_at(&m.table, &["package", "name"]).is_some())
        .map(|m| m.dir.as_str())
        .collect();

    let mut packages = Vec::new();

    for manifest in manifests
        .iter()
        .filter(|m| package_dirs.contains(m.dir.as_str()))
    {
        let Some(name) = string_at(&manifest.table, &["package", "name"]) else {
            continue;
        };
        let lib_name = string_at(&manifest.table, &["lib", "name"])
            .map(str::to_string)
            .unwrap_or_else(|| use_name(name));
        let lib_root = library_root(manifest, source_files);

        packages.push(Package {
            dir: manifest.dir.clone(),
            lib_name,
            lib_root,
            roots: target_roots(manifest, source_files),
            in_repo: BTreeMap::new(),
            foreign: BTreeSet::new(),
        });
    }

    let lib_roots: BTreeMap<String, Option<String>> = packages
        .iter()
        .map(|p| (p.dir.clone(), p.lib_root.clone()))
        .collect();

    for package in &mut packages {
        let manifest = manifests
            .iter()
            .find(|m| m.dir == package.dir)
            .expect("package has a manifest");

        for table in dependency_tables(&manifest.table) {
            for (key, spec) in table {
                let directory = dependency_directory(&manifests, &manifest.dir, key, spec);
                let name = use_name(key);

                match directory.and_then(|d| lib_roots.get(&d)) {
                    Some(Some(lib)) => {
                        package.in_repo.entry(name).or_insert_with(|| lib.clone());
                    }
                    Some(None) => {}
                    None => {
                        package.foreign.insert(name);
                    }
                }
            }
        }

        for name in package.in_repo.keys() {
            package.foreign.remove(name);
        }
    }

    packages
}

fn dependency_directory(
    manifests: &[Manifest],
    package_dir: &str,
    key: &str,
    spec: &Value,
) -> Option<String> {
    let table = spec.as_table()?;

    if let Some(path) = table.get("path").and_then(Value::as_str) {
        return join(package_dir, path);
    }

    if table.get("workspace").and_then(Value::as_bool) == Some(true) {
        let mut current = Some(package_dir);

        while let Some(directory) = current {
            let declared = manifests
                .iter()
                .find(|m| m.dir == directory)
                .and_then(|m| {
                    m.table
                        .get("workspace")?
                        .as_table()?
                        .get("dependencies")?
                        .as_table()
                })
                .and_then(|deps| deps.get(key));

            if let Some(entry) = declared {
                let path = entry.as_table()?.get("path")?.as_str()?;

                return join(directory, path);
            }

            current = if directory.is_empty() {
                None
            } else {
                Some(directory_of(directory))
            };
        }
    }

    None
}

fn library_root(manifest: &Manifest, source_files: &HashSet<String>) -> Option<String> {
    let relative = string_at(&manifest.table, &["lib", "path"]).unwrap_or("src/lib.rs");
    let path = join(&manifest.dir, relative)?;

    source_files.contains(&path).then_some(path)
}

fn target_roots(manifest: &Manifest, source_files: &HashSet<String>) -> Vec<String> {
    let dir = manifest.dir.as_str();
    let mut roots: BTreeSet<String> = BTreeSet::new();
    let mut add = |relative: &str| {
        if let Some(path) = join(dir, relative) {
            if source_files.contains(&path) {
                roots.insert(path);
            }
        }
    };

    add(string_at(&manifest.table, &["lib", "path"]).unwrap_or("src/lib.rs"));
    add("src/main.rs");
    add(string_at(&manifest.table, &["package", "build"]).unwrap_or("build.rs"));

    if let Some(bins) = manifest.table.get("bin").and_then(Value::as_array) {
        for path in bins
            .iter()
            .filter_map(|bin| bin.as_table()?.get("path")?.as_str())
        {
            add(path);
        }
    }

    let prefix = |name: &str| {
        if dir.is_empty() {
            format!("{name}/")
        } else {
            format!("{dir}/{name}/")
        }
    };

    for path in source_files {
        for folder in ["src/bin", "tests", "examples", "benches"] {
            let Some(rest) = path.strip_prefix(&prefix(folder)) else {
                continue;
            };
            let direct = !rest.contains('/');
            let bin_main =
                folder == "src/bin" && rest.matches('/').count() == 1 && rest.ends_with("/main.rs");

            if direct || bin_main {
                roots.insert(path.clone());
            }
        }
    }

    roots.into_iter().collect()
}
