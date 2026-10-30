use std::collections::{HashMap, HashSet};

use crate::crates::{directory_of, join};
use crate::items::Parsed;

pub type ChildKey = (usize, Vec<String>, String);

pub struct Tree {
    pub children: HashMap<ChildKey, usize>,
    pub parents: HashMap<usize, (usize, Vec<String>)>,
    pub owner: Vec<Option<usize>>,
    pub missing: usize,
}

fn candidates(
    path: &str,
    is_root: bool,
    scope: &[String],
    name: &str,
    path_attr: Option<&str>,
) -> Vec<String> {
    let directory = directory_of(path);

    if let Some(attribute) = path_attr {
        return join(directory, attribute).into_iter().collect();
    }

    let file_name = path.rsplit('/').next().unwrap_or(path);
    let stem = file_name.strip_suffix(".rs").unwrap_or(file_name);
    let mut base = if is_root || file_name == "mod.rs" {
        directory.to_string()
    } else {
        join(directory, stem).unwrap_or_default()
    };

    for segment in scope {
        base = join(&base, segment).unwrap_or_default();
    }

    [format!("{name}.rs"), format!("{name}/mod.rs")]
        .iter()
        .filter_map(|tail| join(&base, tail))
        .collect()
}

pub fn build(paths: &[String], parsed: &[Parsed], roots: &[usize]) -> Tree {
    let index: HashMap<&str, usize> = paths
        .iter()
        .enumerate()
        .map(|(position, path)| (path.as_str(), position))
        .collect();
    let root_set: HashSet<usize> = roots.iter().copied().collect();
    let mut children = HashMap::new();
    let mut missing = 0;

    for (file, source) in parsed.iter().enumerate() {
        for declaration in &source.mods {
            let found = candidates(
                &paths[file],
                root_set.contains(&file),
                &declaration.scope,
                &declaration.name,
                declaration.path_attr.as_deref(),
            )
            .into_iter()
            .find_map(|candidate| index.get(candidate.as_str()).copied());

            match found {
                Some(child) => {
                    children.insert(
                        (file, declaration.scope.clone(), declaration.name.clone()),
                        child,
                    );
                }
                None => missing += 1,
            }
        }
    }

    let mut tree = Tree {
        children,
        parents: HashMap::new(),
        owner: vec![None; paths.len()],
        missing,
    };

    let mut ordered = roots.to_vec();

    ordered.sort_unstable();

    for root in ordered {
        if tree.owner[root].is_none() {
            tree.owner[root] = Some(root);
            claim(&mut tree, parsed, root, root);
        }
    }

    tree
}

fn claim(tree: &mut Tree, parsed: &[Parsed], file: usize, root: usize) {
    for declaration in &parsed[file].mods {
        let key = (file, declaration.scope.clone(), declaration.name.clone());
        let Some(&child) = tree.children.get(&key) else {
            continue;
        };

        if tree.owner[child].is_none() {
            tree.owner[child] = Some(root);
            tree.parents
                .insert(child, (file, declaration.scope.clone()));
            claim(tree, parsed, child, root);
        }
    }
}
