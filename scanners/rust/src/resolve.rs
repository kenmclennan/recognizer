use std::collections::{BTreeSet, HashMap, HashSet};

use crate::items::{Parsed, Scope};
use crate::tree::Tree;

const MAX_DEPTH: usize = 16;
const STANDARD: [&str; 3] = ["std", "core", "alloc"];

#[derive(Clone, Debug, PartialEq)]
pub struct Pos {
    pub file: usize,
    pub scope: Vec<String>,
}

#[derive(Default, Clone)]
pub struct Env {
    pub root: Option<usize>,
    pub in_repo: HashMap<String, usize>,
    pub foreign: BTreeSet<String>,
}

#[derive(Debug, PartialEq)]
pub enum Final {
    Target {
        file: usize,
        names: Vec<String>,
        via: Vec<usize>,
    },
    Foreign(String),
    Nothing,
}

enum Res {
    Module(Pos),
    Item {
        file: usize,
        name: Option<String>,
        via: Vec<usize>,
    },
    Foreign(String),
    Nothing,
}

#[derive(Default)]
struct State {
    via: Vec<usize>,
    depth: usize,
    visited: HashSet<(usize, Vec<String>, String)>,
}

pub struct Resolver<'a> {
    pub parsed: &'a [Parsed],
    pub tree: &'a Tree,
    pub envs: &'a [Env],
}

impl<'a> Resolver<'a> {
    fn scope(&self, pos: &Pos) -> Option<&'a Scope> {
        self.parsed[pos.file].scopes.get(&pos.scope)
    }

    fn super_of(&self, pos: &Pos) -> Option<Pos> {
        if let Some((_, rest)) = pos.scope.split_last() {
            return Some(Pos {
                file: pos.file,
                scope: rest.to_vec(),
            });
        }

        self.tree.parents.get(&pos.file).map(|(file, scope)| Pos {
            file: *file,
            scope: scope.clone(),
        })
    }

    fn child(&self, pos: &Pos, name: &str) -> Option<Pos> {
        if self.scope(pos)?.inline.contains(name) {
            let mut scope = pos.scope.clone();

            scope.push(name.to_string());

            return Some(Pos {
                file: pos.file,
                scope,
            });
        }

        self.tree
            .children
            .get(&(pos.file, pos.scope.clone(), name.to_string()))
            .map(|file| Pos {
                file: *file,
                scope: Vec::new(),
            })
    }

    fn is_foreign(&self, file: usize, name: &str) -> bool {
        STANDARD.contains(&name) || self.envs[file].foreign.contains(name)
    }

    fn named_crate(&self, file: usize, name: &str) -> Res {
        if let Some(&lib) = self.envs[file].in_repo.get(name) {
            return Res::Module(Pos {
                file: lib,
                scope: Vec::new(),
            });
        }

        if self.is_foreign(file, name) {
            return Res::Foreign(name.to_string());
        }

        Res::Nothing
    }

    fn start(&self, from: &Pos, first: &str, leading_colon: bool) -> Res {
        if leading_colon {
            return self.named_crate(from.file, first);
        }

        match first {
            "crate" => match self.envs[from.file].root {
                Some(root) => Res::Module(Pos {
                    file: root,
                    scope: Vec::new(),
                }),
                None => Res::Nothing,
            },
            "self" => Res::Module(from.clone()),
            "super" => self.super_of(from).map_or(Res::Nothing, Res::Module),
            _ => {
                if let Some(&lib) = self.envs[from.file].in_repo.get(first) {
                    return Res::Module(Pos {
                        file: lib,
                        scope: Vec::new(),
                    });
                }

                if let Some(child) = self.child(from, first) {
                    return Res::Module(child);
                }

                if self.is_foreign(from.file, first) {
                    return Res::Foreign(first.to_string());
                }

                Res::Nothing
            }
        }
    }

    fn resolve_path(
        &self,
        from: &Pos,
        path: &[String],
        leading_colon: bool,
        state: &mut State,
    ) -> Res {
        let Some((first, mut rest)) = path.split_first() else {
            return Res::Module(from.clone());
        };

        let mut position = match self.start(from, first, leading_colon) {
            Res::Module(position) => position,
            other => return other,
        };

        if !leading_colon && (first == "self" || first == "super") {
            while rest.first().map(String::as_str) == Some("super") {
                match self.super_of(&position) {
                    Some(parent) => position = parent,
                    None => return Res::Nothing,
                }

                rest = &rest[1..];
            }
        }

        self.walk(position, rest, state)
    }

    fn walk(&self, mut position: Pos, segments: &[String], state: &mut State) -> Res {
        for segment in segments {
            if segment == "self" {
                continue;
            }

            match self.lookup(&position, segment, state) {
                Some(Res::Module(next)) => position = next,
                Some(other) => return other,
                None => {
                    return Res::Item {
                        file: position.file,
                        name: None,
                        via: state.via.clone(),
                    }
                }
            }
        }

        Res::Module(position)
    }

    fn stop(&self, position: &Pos, name: &str, state: &State) -> Res {
        Res::Item {
            file: position.file,
            name: Some(name.to_string()),
            via: state.via.clone(),
        }
    }

    fn lookup(&self, position: &Pos, name: &str, state: &mut State) -> Option<Res> {
        if let Some(child) = self.child(position, name) {
            return Some(Res::Module(child));
        }

        let scope = self.scope(position)?;

        if scope.declared.contains(name) {
            return Some(self.stop(position, name, state));
        }

        if let Some(leaf) = scope
            .uses
            .iter()
            .find(|leaf| leaf.public && !leaf.glob && leaf.binding == name)
        {
            let key = (position.file, position.scope.clone(), name.to_string());

            if state.depth >= MAX_DEPTH || !state.visited.insert(key) {
                return Some(self.stop(position, name, state));
            }

            if !state.via.contains(&position.file) {
                state.via.push(position.file);
            }

            state.depth += 1;

            let outcome = self.resolve_path(position, &leaf.path, leaf.leading_colon, state);

            state.depth -= 1;

            return Some(match outcome {
                Res::Nothing => self.stop(position, name, state),
                other => other,
            });
        }

        for leaf in scope.uses.iter().filter(|leaf| leaf.public && leaf.glob) {
            let key = (
                position.file,
                position.scope.clone(),
                format!("*{}", leaf.path.join("::")),
            );

            if state.depth >= MAX_DEPTH || !state.visited.insert(key) {
                continue;
            }

            let mark = state.via.len();

            if !state.via.contains(&position.file) {
                state.via.push(position.file);
            }

            state.depth += 1;

            let target = self.resolve_path(position, &leaf.path, leaf.leading_colon, state);
            let found = match target {
                Res::Module(inner) => self.lookup(&inner, name, state),
                _ => None,
            };

            state.depth -= 1;

            if found.is_some() {
                return found;
            }

            state.via.truncate(mark);
        }

        None
    }

    fn finish(&self, outcome: Res, state: &State) -> Final {
        let (file, names, via) = match outcome {
            Res::Module(position) => (position.file, Vec::new(), state.via.clone()),
            Res::Item { file, name, via } => (file, name.into_iter().collect(), via),
            Res::Foreign(name) => return Final::Foreign(name),
            Res::Nothing => return Final::Nothing,
        };

        Final::Target {
            file,
            names,
            via: via.into_iter().filter(|passed| *passed != file).collect(),
        }
    }

    pub fn resolve_use(
        &self,
        file: usize,
        scope: &[String],
        path: &[String],
        leading_colon: bool,
    ) -> Final {
        let from = Pos {
            file,
            scope: scope.to_vec(),
        };
        let mut state = State::default();
        let outcome = self.resolve_path(&from, path, leading_colon, &mut state);

        self.finish(outcome, &state)
    }

    pub fn resolve_trait(
        &self,
        file: usize,
        scope: &[String],
        path: &[String],
        leading_colon: bool,
    ) -> Final {
        let from = Pos {
            file,
            scope: scope.to_vec(),
        };
        let mut path = path.to_vec();
        let mut colon = leading_colon;
        let owner = self.scope(&from);

        if let Some(owner) = owner {
            for _ in 0..8 {
                if colon || path.is_empty() {
                    break;
                }

                if owner.declared.contains(&path[0]) {
                    return Final::Target {
                        file,
                        names: vec![path[0].clone()],
                        via: Vec::new(),
                    };
                }

                let Some(leaf) = owner
                    .uses
                    .iter()
                    .find(|leaf| !leaf.glob && leaf.binding == path[0])
                else {
                    break;
                };

                let mut expanded = leaf.path.clone();

                expanded.extend_from_slice(&path[1..]);
                colon = leaf.leading_colon;
                path = expanded;
            }
        }

        let mut state = State::default();
        let outcome = self.resolve_path(&from, &path, colon, &mut state);

        if matches!(outcome, Res::Nothing) && path.len() == 1 && !colon {
            if let Some(owner) = owner {
                for leaf in owner.uses.iter().filter(|leaf| leaf.glob) {
                    let mut inner = State::default();
                    let target =
                        self.resolve_path(&from, &leaf.path, leaf.leading_colon, &mut inner);

                    if let Res::Module(position) = target {
                        if let Some(found) = self.lookup(&position, &path[0], &mut inner) {
                            return self.finish(found, &inner);
                        }
                    }
                }
            }
        }

        self.finish(outcome, &state)
    }
}
