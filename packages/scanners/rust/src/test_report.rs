use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::Path;

use sha2::{Digest, Sha256};

const SPACE: &[u8] = b" \t\n\r\x0b\x0c";

fn is_space(byte: u8) -> bool {
    SPACE.contains(&byte)
}

fn is_identifier_byte(byte: u8) -> bool {
    byte == b'_' || byte.is_ascii_alphanumeric()
}

fn sha256_hex(data: &[u8]) -> String {
    format!("{:x}", Sha256::digest(data))
}

fn find(data: &[u8], needle: &[u8], from: usize) -> Option<usize> {
    if from > data.len() {
        return None;
    }

    data[from..]
        .windows(needle.len())
        .position(|window| window == needle)
        .map(|offset| from + offset)
}

fn skip_block_comment(data: &[u8], start: usize) -> usize {
    let mut depth = 0;
    let mut i = start;

    while i < data.len() {
        if data[i..].starts_with(b"/*") {
            depth += 1;
            i += 2;
        } else if data[i..].starts_with(b"*/") {
            depth -= 1;
            i += 2;

            if depth == 0 {
                return i;
            }
        } else {
            i += 1;
        }
    }

    data.len()
}

fn skip_quoted(data: &[u8], start: usize) -> usize {
    let mut i = start + 1;

    while i < data.len() {
        match data[i] {
            b'\\' => i += 2,
            b'"' => return i + 1,
            _ => i += 1,
        }
    }

    data.len()
}

fn skip_raw(data: &[u8], start: usize, hashes: usize) -> usize {
    let mut closing = vec![b'"'];

    closing.extend(std::iter::repeat_n(b'#', hashes));

    find(data, &closing, start).map_or(data.len(), |end| end + closing.len())
}

fn skip_character(data: &[u8], start: usize) -> usize {
    let i = start + 1;

    if i >= data.len() {
        return data.len();
    }

    if data[i] == b'\\' {
        return find(data, b"'", i + 2).map_or(data.len(), |end| end + 1);
    }

    let lead = data[i];
    let width = if lead < 0xC0 {
        1
    } else if lead < 0xE0 {
        2
    } else if lead < 0xF0 {
        3
    } else {
        4
    };

    if i + width < data.len() && data[i + width] == b'\'' {
        return i + width + 1;
    }

    start + 1
}

fn raw_start(data: &[u8], start: usize) -> Option<usize> {
    let mut i = start + 1;
    let mut hashes = 0;

    while i < data.len() && data[i] == b'#' {
        hashes += 1;
        i += 1;
    }

    if i < data.len() && data[i] == b'"' {
        return Some(skip_raw(data, i + 1, hashes));
    }

    None
}

fn skip_literal(data: &[u8], i: usize) -> Option<usize> {
    let byte = data[i];

    if byte == b'/' && data[i..].starts_with(b"//") {
        return Some(find(data, b"\n", i).unwrap_or(data.len()));
    }

    if byte == b'/' && data[i..].starts_with(b"/*") {
        return Some(skip_block_comment(data, i));
    }

    if byte == b'"' {
        return Some(skip_quoted(data, i));
    }

    if byte == b'\'' {
        return Some(skip_character(data, i));
    }

    if (byte == b'r' || byte == b'b') && (i == 0 || !is_identifier_byte(data[i - 1])) {
        let prefix = i + 1;

        if byte == b'b' && prefix < data.len() {
            match data[prefix] {
                b'"' => return Some(skip_quoted(data, prefix)),
                b'\'' => return Some(skip_character(data, prefix)),
                b'r' => return raw_start(data, prefix),
                _ => {}
            }
        }

        if byte == b'r' {
            return raw_start(data, i);
        }
    }

    None
}

fn skip_trivia(data: &[u8], start: usize) -> usize {
    let mut i = start;

    while i < data.len() {
        if is_space(data[i]) {
            i += 1;
        } else if data[i..].starts_with(b"//") || data[i..].starts_with(b"/*") {
            i = skip_literal(data, i).unwrap_or(i + 1);
        } else {
            break;
        }
    }

    i
}

fn attribute_end(data: &[u8], start: usize) -> usize {
    let mut depth = 1;
    let mut i = start;

    while i < data.len() {
        if let Some(skipped) = skip_literal(data, i) {
            i = skipped;
            continue;
        }

        if data[i] == b'[' {
            depth += 1;
        } else if data[i] == b']' {
            depth -= 1;

            if depth == 0 {
                return i + 1;
            }
        }

        i += 1;
    }

    data.len()
}

fn gate_tokens(text: &[u8]) -> Option<Vec<&[u8]>> {
    let mut tokens: Vec<&[u8]> = Vec::new();
    let mut i = 0;

    while i < text.len() {
        let c = text[i];

        if is_space(c) {
            i += 1;
        } else if matches!(c, b'(' | b')' | b',' | b'=') {
            tokens.push(&text[i..i + 1]);
            i += 1;
        } else if c == b'_' || c.is_ascii_alphabetic() {
            let start = i;

            while i < text.len() && is_identifier_byte(text[i]) {
                i += 1;
            }

            tokens.push(&text[start..i]);
        } else if c == b'"' {
            let mut j = i + 1;

            while j < text.len() && text[j] != b'"' {
                j += if text[j] == b'\\' { 2 } else { 1 };
            }

            if j >= text.len() {
                return None;
            }

            tokens.push(&text[i..i + 1]);
            i = j + 1;
        } else {
            return None;
        }
    }

    Some(tokens)
}

fn gate_predicate(tokens: &[&[u8]], at: usize) -> Option<(usize, bool)> {
    let name = *tokens.get(at)?;

    if !(name[0] == b'_' || name[0].is_ascii_alphabetic()) {
        return None;
    }

    match tokens.get(at + 1).copied() {
        Some(b"=") => {
            return if tokens.get(at + 2).copied() == Some(b"\"") {
                Some((at + 3, false))
            } else {
                None
            };
        }
        Some(b"(") => {}
        _ => return Some((at + 1, name == b"test")),
    }

    let mut results: Vec<bool> = Vec::new();
    let mut i = at + 2;

    while tokens.get(i).copied() != Some(b")") {
        let (next, requires_test) = gate_predicate(tokens, i)?;

        results.push(requires_test);
        i = next;

        match tokens.get(i).copied() {
            Some(b",") => i += 1,
            Some(b")") => {}
            _ => return None,
        }
    }

    let requires_test = match name {
        b"all" => results.iter().any(|r| *r),
        b"any" => !results.is_empty() && results.iter().all(|r| *r),
        _ => false,
    };

    Some((i + 1, requires_test))
}

pub fn is_test_attribute(inner: &[u8]) -> bool {
    let compact: Vec<u8> = inner.iter().copied().filter(|b| !is_space(*b)).collect();

    if compact == b"test" {
        return true;
    }

    let Some(tokens) = gate_tokens(inner) else {
        return false;
    };

    if tokens.len() < 2 || tokens[0] != b"cfg" || tokens[1] != b"(" {
        return false;
    }

    match gate_predicate(&tokens, 2) {
        Some((end, requires_test)) => {
            requires_test && end + 1 == tokens.len() && tokens[end] == b")"
        }
        None => false,
    }
}

fn item_end(data: &[u8], start: usize) -> usize {
    let mut depth: usize = 0;
    let mut first_brace: Option<usize> = None;
    let mut i = start;

    while i < data.len() {
        if let Some(skipped) = skip_literal(data, i) {
            i = skipped;
            continue;
        }

        let byte = data[i];

        match byte {
            b'(' | b'[' | b'{' => {
                if byte == b'{' && first_brace.is_none() {
                    first_brace = Some(depth);
                }

                depth += 1;
            }
            b')' | b']' | b'}' => {
                if depth == 0 {
                    return i;
                }

                depth -= 1;

                if byte == b'}' && first_brace == Some(depth) {
                    return i + 1;
                }
            }
            b';' if depth == 0 => return i + 1,
            _ => {}
        }

        i += 1;
    }

    data.len()
}

struct ModuleHead {
    name: String,
    inline: bool,
    after: usize,
}

fn module_head(text: &[u8], start: usize) -> Option<ModuleHead> {
    let n = text.len();
    let skip_space = |mut at: usize| {
        while at < n && is_space(text[at]) {
            at += 1;
        }

        at
    };
    let mut i = skip_space(start);

    if text[i..].starts_with(b"pub") {
        let after = i + 3;

        if after < n && text[after] == b'(' {
            let close = find(text, b")", after)?;

            i = skip_space(close + 1);
        } else if after < n && is_space(text[after]) {
            i = skip_space(after);
        } else {
            return None;
        }
    }

    if !text[i..].starts_with(b"mod") {
        return None;
    }

    let after = i + 3;

    if after >= n || !is_space(text[after]) {
        return None;
    }

    i = skip_space(after);

    if i >= n || !(text[i] == b'_' || text[i].is_ascii_alphabetic()) {
        return None;
    }

    let name_start = i;

    while i < n && is_identifier_byte(text[i]) {
        i += 1;
    }

    let name = String::from_utf8_lossy(&text[name_start..i]).into_owned();

    i = skip_space(i);

    if i < n && text[i] == b';' {
        Some(ModuleHead {
            name,
            inline: false,
            after: i + 1,
        })
    } else if i < n && text[i] == b'{' {
        Some(ModuleHead {
            name,
            inline: true,
            after: i + 1,
        })
    } else {
        None
    }
}

fn path_value(inner: &[u8]) -> Option<String> {
    let text = String::from_utf8_lossy(inner);
    let rest = text.trim_start().strip_prefix("path")?.trim_start();
    let rest = rest.strip_prefix('=')?.trim_start().strip_prefix('"')?;
    let mut end = 0;
    let bytes = rest.as_bytes();

    while end < bytes.len() {
        match bytes[end] {
            b'\\' => end += 2,
            b'"' => break,
            _ => end += 1,
        }
    }

    if end >= bytes.len() || !rest[end + 1..].trim().is_empty() {
        return None;
    }

    Some(rest[..end].to_string())
}

struct Declaration {
    scope: Vec<String>,
    name: String,
    path: Option<String>,
    is_test: bool,
}

struct Scanned {
    items: Vec<(usize, usize)>,
    file_level: bool,
    declarations: Vec<Declaration>,
}

fn scan(data: &[u8]) -> Scanned {
    let mut scanned = Scanned {
        items: Vec::new(),
        file_level: false,
        declarations: Vec::new(),
    };
    let mut scope: Vec<(String, usize)> = Vec::new();
    let mut depth = 0usize;
    let mut nesting = 0usize;
    let mut i = 0;

    while i < data.len() {
        if let Some(skipped) = skip_literal(data, i) {
            i = skipped;
            continue;
        }

        if data[i..].starts_with(b"#![") {
            let end = attribute_end(data, i + 3);

            if depth == 0 && is_test_attribute(&data[i + 3..end - 1]) {
                scanned.file_level = true;
            }

            i = end;
            continue;
        }

        if data[i..].starts_with(b"#[") {
            let start = i;
            let mut end = attribute_end(data, i + 2);
            let mut is_test = is_test_attribute(&data[i + 2..end - 1]);
            let mut path = path_value(&data[i + 2..end - 1]);
            let mut follow = skip_trivia(data, end);

            while data[follow..].starts_with(b"#[") {
                end = attribute_end(data, follow + 2);
                is_test = is_test || is_test_attribute(&data[follow + 2..end - 1]);
                path = path.or_else(|| path_value(&data[follow + 2..end - 1]));
                follow = skip_trivia(data, end);
            }

            if !is_test {
                match module_head(data, end) {
                    None => i = end,
                    Some(head) => {
                        i = head.after;
                        enter(
                            &mut scanned,
                            &mut scope,
                            (&mut depth, nesting),
                            head,
                            path,
                            false,
                        );
                    }
                }

                continue;
            }

            let stop = item_end(data, end);

            scanned.items.push((start, stop));

            if let Some(head) = module_head(&data[end..stop], 0) {
                if !head.inline {
                    enter(
                        &mut scanned,
                        &mut scope,
                        (&mut depth, nesting),
                        head,
                        path,
                        true,
                    );
                }
            }

            i = stop.max(end);
            continue;
        }

        let byte = data[i];

        if byte == b'{' {
            depth += 1;
        } else if byte == b'}' {
            depth = depth.saturating_sub(1);

            if scope.last().is_some_and(|(_, at)| *at == depth) {
                scope.pop();
            }
        } else if byte == b'(' || byte == b'[' {
            nesting += 1;
        } else if byte == b')' || byte == b']' {
            nesting = nesting.saturating_sub(1);
        } else if (byte == b'm' || byte == b'p') && (i == 0 || !is_identifier_byte(data[i - 1])) {
            if let Some(head) = module_head(data, i) {
                i = head.after;
                enter(
                    &mut scanned,
                    &mut scope,
                    (&mut depth, nesting),
                    head,
                    None,
                    false,
                );
                continue;
            }
        }

        i += 1;
    }

    scanned
}

fn enter(
    scanned: &mut Scanned,
    scope: &mut Vec<(String, usize)>,
    (depth, nesting): (&mut usize, usize),
    head: ModuleHead,
    path: Option<String>,
    is_test: bool,
) {
    if head.inline {
        scope.push((head.name, *depth));
        *depth += 1;
    } else if *depth == scope.len() && nesting == 0 {
        scanned.declarations.push(Declaration {
            scope: scope.iter().map(|(name, _)| name.clone()).collect(),
            name: head.name,
            path,
            is_test,
        });
    }
}

fn split_path(path: &str) -> (&str, &str) {
    path.rsplit_once('/').unwrap_or(("", path))
}

fn is_root_file(path: &str) -> bool {
    let (parent, name) = split_path(path);

    if matches!(name, "lib.rs" | "main.rs" | "build.rs") {
        return true;
    }

    let (grandparent, parent_name) = split_path(parent);

    if matches!(parent_name, "examples" | "benches") {
        return true;
    }

    parent_name == "bin" && split_path(grandparent).1 == "src"
}

pub struct Roots {
    pub roots: BTreeSet<String>,
    pub covered: BTreeSet<String>,
}

impl Roots {
    fn is_root(&self, path: &str) -> bool {
        let mut directory = split_path(path).0;

        loop {
            if self.covered.contains(directory) {
                return self.roots.contains(path);
            }

            if directory.is_empty() {
                return is_root_file(path);
            }

            directory = split_path(directory).0;
        }
    }
}

fn join_root(directory: &str, relative: &str) -> Option<String> {
    let mut parts: Vec<&str> = Vec::new();
    let whole = if directory.is_empty() {
        relative.to_string()
    } else {
        format!("{directory}/{relative}")
    };

    for part in whole.split('/') {
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

pub fn manifest_roots(listed: &[String], read: &dyn Fn(&str) -> Option<String>) -> Roots {
    let paths: BTreeSet<&str> = listed.iter().map(String::as_str).collect();
    let mut roots = BTreeSet::new();
    let mut covered = BTreeSet::new();

    for manifest in paths.iter().filter(|p| split_path(p).1 == "Cargo.toml") {
        let Some(table) = read(manifest).and_then(|text| text.parse::<toml::Table>().ok()) else {
            continue;
        };
        let package = table.get("package").and_then(toml::Value::as_table);

        if package
            .and_then(|package| package.get("name"))
            .and_then(toml::Value::as_str)
            .is_none()
        {
            continue;
        }

        let directory = split_path(manifest).0;

        covered.insert(directory.to_string());

        let mut declare = |relative: &str| {
            if let Some(found) = join_root(directory, relative) {
                if paths.contains(found.as_str()) {
                    roots.insert(found);
                }
            }
        };
        let library = table
            .get("lib")
            .and_then(toml::Value::as_table)
            .and_then(|lib| lib.get("path"))
            .and_then(toml::Value::as_str);

        declare(library.unwrap_or("src/lib.rs"));
        declare("src/main.rs");

        match package.and_then(|package| package.get("build")) {
            Some(toml::Value::Boolean(false)) => {}
            Some(toml::Value::String(path)) => declare(path),
            _ => declare("build.rs"),
        }

        for kind in ["bin", "example", "bench", "test"] {
            let entries = table.get(kind).and_then(toml::Value::as_array);

            for path in entries
                .into_iter()
                .flatten()
                .filter_map(|entry| entry.as_table()?.get("path")?.as_str())
            {
                declare(path);
            }
        }

        for folder in ["src/bin", "examples", "benches"] {
            let prefix = if directory.is_empty() {
                format!("{folder}/")
            } else {
                format!("{directory}/{folder}/")
            };

            for path in paths.iter().filter(|p| p.ends_with(".rs")) {
                let Some(rest) = path.strip_prefix(prefix.as_str()) else {
                    continue;
                };
                let slashes = rest.matches('/').count();

                if slashes == 0 || (slashes == 1 && rest.ends_with("/main.rs")) {
                    roots.insert(path.to_string());
                }
            }
        }
    }

    Roots { roots, covered }
}

fn normalize(path: &str) -> Option<String> {
    if path.starts_with('/') {
        return None;
    }

    let mut parts: Vec<&str> = Vec::new();

    for segment in path.split('/') {
        match segment {
            "" | "." => {}
            ".." => {
                parts.pop()?;
            }
            other => parts.push(other),
        }
    }

    (!parts.is_empty()).then(|| parts.join("/"))
}

fn join_module(base: &str, tail: &str) -> Option<String> {
    if base.is_empty() {
        normalize(tail)
    } else {
        normalize(&format!("{base}/{tail}"))
    }
}

fn module_candidates(file: &str, declaration: &Declaration, roots: &Roots) -> Vec<String> {
    let (directory, name) = split_path(file);

    if let Some(path) = &declaration.path {
        return join_module(directory, path).into_iter().collect();
    }

    let stem = name.strip_suffix(".rs").unwrap_or(name);
    let mut base = if roots.is_root(file) || name == "mod.rs" {
        directory.to_string()
    } else {
        join_module(directory, stem).unwrap_or_default()
    };

    for segment in &declaration.scope {
        base = join_module(&base, segment).unwrap_or_default();
    }

    [
        format!("{}.rs", declaration.name),
        format!("{}/mod.rs", declaration.name),
    ]
    .iter()
    .filter_map(|tail| join_module(&base, tail))
    .collect()
}

fn resolved(
    file: &str,
    declaration: &Declaration,
    index: &BTreeSet<&str>,
    roots: &Roots,
) -> Option<String> {
    module_candidates(file, declaration, roots)
        .into_iter()
        .find(|candidate| index.contains(candidate.as_str()))
}

fn mark(path: Option<String>, marked: &mut BTreeSet<String>, pending: &mut Vec<String>) {
    if let Some(path) = path {
        if marked.insert(path.clone()) {
            pending.push(path);
        }
    }
}

fn test_file_set(
    folder: &Path,
    sources: &[&String],
    first_pass: &BTreeMap<String, (Vec<u8>, Scanned)>,
    roots: &Roots,
) -> BTreeSet<String> {
    let index: BTreeSet<&str> = sources.iter().map(|path| path.as_str()).collect();
    let mut marked: BTreeSet<String> = BTreeSet::new();
    let mut pending: Vec<String> = Vec::new();

    for (path, (_, scanned)) in first_pass {
        if scanned.file_level {
            mark(Some(path.clone()), &mut marked, &mut pending);
        }

        for declaration in scanned.declarations.iter().filter(|d| d.is_test) {
            mark(
                resolved(path, declaration, &index, roots),
                &mut marked,
                &mut pending,
            );
        }
    }

    while let Some(file) = pending.pop() {
        let read;
        let declarations = match first_pass.get(&file) {
            Some((_, scanned)) => &scanned.declarations,
            None => {
                read = fs::read(folder.join(&file))
                    .map(|data| scan(&data).declarations)
                    .unwrap_or_default();
                &read
            }
        };
        let found: Vec<Option<String>> = declarations
            .iter()
            .map(|declaration| resolved(&file, declaration, &index, roots))
            .collect();

        for path in found {
            mark(path, &mut marked, &mut pending);
        }
    }

    marked
}

pub fn in_file_test_hashes(
    folder: &Path,
    listed: &[String],
    is_test_file: fn(&str) -> bool,
) -> BTreeMap<String, String> {
    let mut sources: Vec<&String> = listed.iter().filter(|p| p.ends_with(".rs")).collect();

    sources.sort();
    sources.dedup();

    let mut entries = BTreeMap::new();
    let mut first_pass: BTreeMap<String, (Vec<u8>, Scanned)> = BTreeMap::new();

    for path in &sources {
        if is_test_file(path) {
            continue;
        }

        let Ok(data) = fs::read(folder.join(path)) else {
            continue;
        };

        if find(&data, b"test", 0).is_none() {
            continue;
        }

        let scanned = scan(&data);

        for (number, (start, stop)) in scanned.items.iter().enumerate() {
            entries.insert(format!("{path}#{number}"), sha256_hex(&data[*start..*stop]));
        }

        first_pass.insert(path.to_string(), (data, scanned));
    }

    let roots = manifest_roots(listed, &|path| fs::read_to_string(folder.join(path)).ok());

    for path in test_file_set(folder, &sources, &first_pass, &roots) {
        if let Ok(data) = fs::read(folder.join(&path)) {
            entries.insert(format!("{path}#file"), sha256_hex(&data));
        }
    }

    entries
}

const TEST_DIRECTORIES: [&str; 3] = ["test", "tests", "__tests__"];
const SCRIPT_EXTENSIONS: [&str; 8] = ["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"];

fn stem_of(basename: &str) -> &str {
    match basename.rfind('.') {
        Some(dot) if dot > 0 => &basename[..dot],
        _ => basename,
    }
}

fn is_test_basename(basename: &str) -> bool {
    let python = (basename.starts_with("test_") && basename.ends_with(".py"))
        || basename.ends_with("_test.py")
        || basename == "conftest.py";

    let script = SCRIPT_EXTENSIONS.iter().any(|extension| {
        basename.ends_with(&format!(".test.{extension}"))
            || basename.ends_with(&format!(".spec.{extension}"))
    });

    python || script
}

pub fn is_test_file(module_id: &str) -> bool {
    let mut parts: Vec<&str> = module_id.split('/').collect();
    let basename = parts.pop().unwrap_or("");

    if parts.iter().any(|part| TEST_DIRECTORIES.contains(part)) {
        return true;
    }

    if basename.ends_with(".cs")
        && parts
            .iter()
            .any(|part| part.ends_with("Test") || part.ends_with("Tests"))
    {
        return true;
    }

    if is_test_basename(basename) {
        return true;
    }

    let stem = stem_of(basename);

    stem.ends_with("Test") || stem.ends_with("Tests")
}

pub fn listed_files(folder: &Path) -> Option<Vec<String>> {
    let output = std::process::Command::new("git")
        .arg("-C")
        .arg(folder)
        .args([
            "ls-files",
            "--cached",
            "--others",
            "--exclude-standard",
            "-z",
            "--",
            ".",
            ":!.recognizer",
        ])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    Some(
        output
            .stdout
            .split(|byte| *byte == 0)
            .filter(|entry| !entry.is_empty())
            .map(|entry| String::from_utf8_lossy(entry).into_owned())
            .collect(),
    )
}

pub fn report(folder: &Path) -> Option<BTreeMap<String, String>> {
    let listed = listed_files(folder)?;

    Some(in_file_test_hashes(folder, &listed, is_test_file))
}
