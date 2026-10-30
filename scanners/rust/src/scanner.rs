use std::collections::{BTreeSet, HashMap, HashSet};
use std::fs;
use std::path::Path;

use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

use crate::crates::{read_packages, Package};
use crate::discovery::{manifests, selection, source_files};
use crate::items::{self, Parsed};
use crate::resolve::{Env, Final, Resolver};
use crate::tree;

pub const SCANNER_NAME: &str = "recognizer-scan-rust";

pub struct Scan {
    pub document: Value,
    pub missing_mods: usize,
}

pub struct ScanError {
    pub problems: Vec<String>,
}

struct Edge {
    from: String,
    to: String,
    kind: &'static str,
    line: usize,
    member: Option<String>,
    to_member: Option<String>,
    names: Vec<String>,
    via: Vec<String>,
}

impl Edge {
    fn order(&self) -> (String, usize, String, &'static str, String, String) {
        (
            self.from.clone(),
            self.line,
            self.to.clone(),
            self.kind,
            self.member.clone().unwrap_or_default(),
            self.names.join(","),
        )
    }

    fn json(&self) -> Value {
        let mut found = Map::new();

        found.insert("from".into(), json!(self.from));
        found.insert("to".into(), json!(self.to));
        found.insert("kind".into(), json!(self.kind));
        found.insert("line".into(), json!(self.line));

        if let Some(member) = &self.member {
            found.insert("member".into(), json!(member));
        }

        if let Some(to_member) = &self.to_member {
            found.insert("to_member".into(), json!(to_member));
        }

        if !self.names.is_empty() {
            found.insert("names".into(), json!(self.names));
        }

        if !self.via.is_empty() {
            found.insert("via".into(), json!(self.via));
        }

        Value::Object(found)
    }
}

fn module_kind(members: &[Value]) -> &'static str {
    let exported: Vec<&Value> = members.iter().filter(|m| m["exported"] == true).collect();

    if !exported.is_empty() && exported.iter().all(|m| m["kind"] == "interface") {
        "interface"
    } else {
        "module"
    }
}

fn package_of(packages: &[Package], root_file: Option<&str>, path: &str) -> Option<usize> {
    if let Some(root) = root_file {
        if let Some(found) = packages
            .iter()
            .position(|p| p.roots.iter().any(|r| r == root))
        {
            return Some(found);
        }
    }

    packages
        .iter()
        .enumerate()
        .filter(|(_, p)| p.dir.is_empty() || path.starts_with(&format!("{}/", p.dir)))
        .max_by_key(|(_, p)| p.dir.len())
        .map(|(position, _)| position)
}

fn build_envs(
    paths: &[String],
    index: &HashMap<&str, usize>,
    packages: &[Package],
    owner: &[Option<usize>],
) -> Vec<Env> {
    paths
        .iter()
        .enumerate()
        .map(|(file, path)| {
            let root = owner[file];
            let package = package_of(packages, root.map(|r| paths[r].as_str()), path);
            let mut env = Env {
                root,
                ..Env::default()
            };

            if let Some(package) = package.map(|p| &packages[p]) {
                for (name, lib) in &package.in_repo {
                    if let Some(&target) = index.get(lib.as_str()) {
                        env.in_repo.insert(name.clone(), target);
                    }
                }

                env.foreign = package.foreign.clone();

                if let Some(lib) = package.lib_root.as_deref().and_then(|l| index.get(l)) {
                    if root != Some(*lib) && !env.in_repo.contains_key(&package.lib_name) {
                        env.in_repo.insert(package.lib_name.clone(), *lib);
                    }
                }
            }

            env
        })
        .collect()
}

fn merge(edges: Vec<Edge>) -> Vec<Edge> {
    let mut merged: Vec<Edge> = Vec::new();
    let mut seen: HashMap<String, usize> = HashMap::new();

    for edge in edges {
        let key = format!(
            "{}|{}|{}|{}|{:?}|{:?}|{:?}|{}",
            edge.from,
            edge.to,
            edge.kind,
            edge.line,
            edge.member,
            edge.to_member,
            edge.via,
            edge.names.is_empty()
        );

        match seen.get(&key) {
            Some(&position) => {
                for name in edge.names {
                    if !merged[position].names.contains(&name) {
                        merged[position].names.push(name);
                    }
                }
            }
            None => {
                seen.insert(key, merged.len());
                merged.push(edge);
            }
        }
    }

    merged
}

fn hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

pub fn scan(
    root: &Path,
    commit: Option<String>,
    modified: Option<bool>,
) -> Result<Scan, ScanError> {
    let paths = source_files(root);
    let mut parsed: Vec<Parsed> = Vec::new();
    let mut hashes: Vec<String> = Vec::new();
    let mut problems = Vec::new();

    for path in &paths {
        let bytes = match fs::read(root.join(path)) {
            Ok(bytes) => bytes,
            Err(error) => {
                problems.push(format!("{path}: {error}"));
                continue;
            }
        };

        hashes.push(hex(&bytes));

        match String::from_utf8(bytes) {
            Ok(source) => match items::parse(&source) {
                Ok(file) => parsed.push(file),
                Err(message) => problems.push(format!("{path}: {message}")),
            },
            Err(_) => problems.push(format!("{path}: stream did not contain valid UTF-8")),
        }
    }

    if !problems.is_empty() {
        return Err(ScanError { problems });
    }

    let index: HashMap<&str, usize> = paths
        .iter()
        .enumerate()
        .map(|(position, path)| (path.as_str(), position))
        .collect();
    let source_set: HashSet<String> = paths.iter().cloned().collect();
    let packages = read_packages(root, &manifests(root), &source_set);
    let roots: Vec<usize> = packages
        .iter()
        .flat_map(|p| p.roots.iter())
        .filter_map(|r| index.get(r.as_str()).copied())
        .collect::<BTreeSet<usize>>()
        .into_iter()
        .collect();
    let tree = tree::build(&paths, &parsed, &roots);
    let envs = build_envs(&paths, &index, &packages, &tree.owner);
    let resolver = Resolver {
        parsed: &parsed,
        tree: &tree,
        envs: &envs,
    };

    let mut edges = Vec::new();
    let mut foreign = BTreeSet::new();
    let mut modules = Vec::new();

    for (file, source) in parsed.iter().enumerate() {
        let id = &paths[file];

        modules.push(json!({
            "id": id,
            "language": "rust",
            "kind": module_kind(&source.members),
            "members": source.members,
        }));

        for declaration in &source.mods {
            let key = (file, declaration.scope.clone(), declaration.name.clone());

            if let Some(&child) = tree.children.get(&key) {
                edges.push(Edge {
                    from: id.clone(),
                    to: paths[child].clone(),
                    kind: "depends",
                    line: declaration.line,
                    member: None,
                    to_member: None,
                    names: Vec::new(),
                    via: Vec::new(),
                });
            }
        }

        for (scope, content) in &source.scopes {
            for leaf in &content.uses {
                match resolver.resolve_use(file, scope, &leaf.path, leaf.leading_colon) {
                    Final::Target {
                        file: target,
                        names,
                        via,
                    } if target != file => {
                        edges.push(Edge {
                            from: id.clone(),
                            to: paths[target].clone(),
                            kind: "depends",
                            line: leaf.line,
                            member: None,
                            to_member: None,
                            names: if leaf.glob { Vec::new() } else { names },
                            via: via.into_iter().map(|v| paths[v].clone()).collect(),
                        });
                    }
                    Final::Foreign(name) => {
                        edges.push(Edge {
                            from: id.clone(),
                            to: format!("foreign:{name}"),
                            kind: "depends",
                            line: leaf.line,
                            member: None,
                            to_member: None,
                            names: Vec::new(),
                            via: Vec::new(),
                        });
                        foreign.insert(name);
                    }
                    _ => {}
                }
            }
        }

        for implementation in &source.impls {
            let resolved = resolver.resolve_trait(
                file,
                &implementation.scope,
                &implementation.trait_path,
                implementation.leading_colon,
            );

            if let Final::Target {
                file: target,
                names,
                ..
            } = resolved
            {
                if target != file {
                    let to_member = names
                        .first()
                        .cloned()
                        .or_else(|| implementation.trait_path.last().cloned());

                    edges.push(Edge {
                        from: id.clone(),
                        to: paths[target].clone(),
                        kind: "implements",
                        line: implementation.line,
                        member: Some(implementation.type_name.clone()),
                        to_member,
                        names: Vec::new(),
                        via: Vec::new(),
                    });
                }
            }
        }
    }

    let mut edges = merge(edges);

    edges.sort_by_key(Edge::order);

    let document = json!({
        "schema_version": 5,
        "scanner": {"name": SCANNER_NAME, "version": env!("CARGO_PKG_VERSION")},
        "commit": commit,
        "modified": modified,
        "files": paths
            .iter()
            .zip(&hashes)
            .map(|(path, hash)| json!({"path": path, "hash": hash}))
            .collect::<Vec<Value>>(),
        "selection": selection(),
        "modules": modules,
        "edges": edges.iter().map(Edge::json).collect::<Vec<Value>>(),
        "foreign": foreign
            .iter()
            .map(|name| json!({"id": format!("foreign:{name}"), "name": name}))
            .collect::<Vec<Value>>(),
    });

    Ok(Scan {
        document,
        missing_mods: tree.missing,
    })
}

pub fn render(document: &Value) -> String {
    let mut text = serde_json::to_string_pretty(document).expect("a document serialises");

    text.push('\n');

    text
}
