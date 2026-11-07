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

fn is_test_attribute(inner: &[u8]) -> bool {
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
                        enter(&mut scanned, &mut scope, &mut depth, head, path, false);
                    }
                }

                continue;
            }

            let stop = item_end(data, end);

            scanned.items.push((start, stop));

            if let Some(head) = module_head(&data[end..stop], 0) {
                if !head.inline {
                    enter(&mut scanned, &mut scope, &mut depth, head, path, true);
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
        } else if (byte == b'm' || byte == b'p') && (i == 0 || !is_identifier_byte(data[i - 1])) {
            if let Some(head) = module_head(data, i) {
                i = head.after;
                enter(&mut scanned, &mut scope, &mut depth, head, None, false);
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
    depth: &mut usize,
    head: ModuleHead,
    path: Option<String>,
    is_test: bool,
) {
    if head.inline {
        scope.push((head.name, *depth));
        *depth += 1;
    } else {
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

fn module_candidates(file: &str, declaration: &Declaration) -> Vec<String> {
    let (directory, name) = split_path(file);

    if let Some(path) = &declaration.path {
        return join_module(directory, path).into_iter().collect();
    }

    let stem = name.strip_suffix(".rs").unwrap_or(name);
    let mut base = if is_root_file(file) || name == "mod.rs" {
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

fn resolved(file: &str, declaration: &Declaration, index: &BTreeSet<&str>) -> Option<String> {
    module_candidates(file, declaration)
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
                resolved(path, declaration, &index),
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
            .map(|declaration| resolved(&file, declaration, &index))
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

    for path in test_file_set(folder, &sources, &first_pass) {
        if let Ok(data) = fs::read(folder.join(&path)) {
            entries.insert(format!("{path}#file"), sha256_hex(&data));
        }
    }

    entries
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;
    use std::process::Command;
    use tempfile::TempDir;

    fn root() -> std::path::PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
    }

    fn git_init(dir: &Path) {
        Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(["init", "-q"])
            .status()
            .unwrap();
    }

    fn copy_tree(from: &Path, to: &Path) {
        fs::create_dir_all(to).unwrap();

        for entry in fs::read_dir(from).unwrap() {
            let entry = entry.unwrap();
            let target = to.join(entry.file_name());

            if entry.file_type().unwrap().is_dir() {
                copy_tree(&entry.path(), &target);
            } else {
                fs::copy(entry.path(), target).unwrap();
            }
        }
    }

    fn fixture_copy() -> TempDir {
        let dir = TempDir::new().unwrap();

        copy_tree(
            &root().join("fixtures/sensors/tests-digest/rust-in-file"),
            dir.path(),
        );
        git_init(dir.path());

        dir
    }

    fn repository(files: &[(&str, &str)]) -> TempDir {
        let dir = TempDir::new().unwrap();

        for (name, text) in files {
            let target = dir.path().join(name);

            fs::create_dir_all(target.parent().unwrap()).unwrap();
            fs::write(target, text).unwrap();
        }

        dir
    }

    fn entries_of(files: &[(&str, &str)]) -> Vec<String> {
        let dir = repository(files);
        let listed: Vec<String> = files.iter().map(|(name, _)| name.to_string()).collect();

        in_file_test_hashes(dir.path(), &listed, crate::overlays::is_test_file)
            .into_keys()
            .collect()
    }

    fn expected() -> Value {
        let text =
            fs::read_to_string(root().join("fixtures/sensors/tests-digest/expected.json")).unwrap();

        serde_json::from_str(&text).unwrap()
    }

    fn edit(dir: &TempDir, path: &str, from: &str, to: &str) {
        let text = fs::read_to_string(dir.path().join(path)).unwrap();

        assert!(text.contains(from), "{from}");

        fs::write(dir.path().join(path), text.replacen(from, to, 1)).unwrap();
    }

    fn digest(dir: &TempDir) -> String {
        crate::overlays::tests_hash(dir.path(), &Default::default())
    }

    #[test]
    fn the_fixture_gives_the_shared_entries() {
        let dir = fixture_copy();
        let listed: Vec<String> = expected()["entries"]
            .as_object()
            .unwrap()
            .keys()
            .map(|key| key.split('#').next().unwrap().to_string())
            .collect();
        let found = in_file_test_hashes(dir.path(), &listed, crate::overlays::is_test_file);
        let want: BTreeMap<String, String> = expected()["entries"]
            .as_object()
            .unwrap()
            .iter()
            .filter(|(key, _)| key.contains('#'))
            .map(|(key, value)| (key.clone(), value.as_str().unwrap().to_string()))
            .collect();

        assert_eq!(found, want);
    }

    #[test]
    fn production_edits_leave_the_digest_and_test_edits_change_it() {
        let base = expected()["digest"].as_str().unwrap().to_string();

        for (path, from, to) in [
            ("src/lib.rs", "a + b", "b + a"),
            ("src/more.rs", "x * 2", "x * 3"),
        ] {
            let dir = fixture_copy();

            edit(&dir, path, from, to);

            assert_eq!(digest(&dir), base, "{path}");
        }

        for (path, from, to) in [
            (
                "src/lib.rs",
                "assert_eq!(add(1, 2), 3)",
                "assert_eq!(add(1, 2), 4)",
            ),
            ("src/more/helper_tests.rs", ", 4)", ", 5)"),
            ("src/inner.rs", "    7\n", "    9\n"),
            ("src/lib.rs", "fn adds()", "fn  adds()"),
        ] {
            let dir = fixture_copy();

            edit(&dir, path, from, to);

            assert_ne!(digest(&dir), base, "{path}");

            edit(&dir, path, to, from);

            assert_eq!(digest(&dir), base, "{path}");
        }
    }

    #[test]
    fn swapping_deleting_and_boundary_cases() {
        let base = expected()["digest"].as_str().unwrap().to_string();
        let dir = fixture_copy();
        let text = fs::read_to_string(dir.path().join("src/lib.rs")).unwrap();
        let split = text.find("#[cfg(all(test, unix))]").unwrap();
        let module = text.find("#[cfg(test)]\nmod tests").unwrap();
        let swapped = format!(
            "{}{}\n{}",
            &text[..split],
            &text[module..],
            &text[split..module]
        );

        fs::write(dir.path().join("src/lib.rs"), swapped).unwrap();

        assert_ne!(digest(&dir), base);

        fs::write(dir.path().join("src/lib.rs"), &text[..module]).unwrap();

        assert_ne!(digest(&dir), base);

        let dir = fixture_copy();
        let more = fs::read_to_string(dir.path().join("src/more.rs")).unwrap();

        fs::write(dir.path().join("src/more.rs"), more.trim_end()).unwrap();

        assert_eq!(digest(&dir), base);

        fs::write(dir.path().join("src/at_eof.rs"), "#[test] fn at_eof() {}").unwrap();

        assert_ne!(digest(&dir), base);
    }

    #[test]
    fn literals_and_comments_hide_attributes() {
        for text in [
            "// #[test]\nfn a() {}\n",
            "/* /* #[test] */ #[test] */\nfn a() {}\n",
            "const A: &str = \"#[test]\";\n",
            "const A: &str = r#\"#[test]\"#;\n",
            "const A: &str = r##\"a\"#b\"##;\n",
            "const A: &[u8] = b\"#[test]\";\n",
            "const A: &[u8] = br#\"#[test]\"#;\n",
            "#[cfg_attr(test, derive(Debug))]\nstruct A;\n",
            "#[cfg(not(test))]\nfn a() {}\n",
            "#[cfg(feature = \"testing\")]\nfn a() {}\n",
        ] {
            let text = format!("{text}// test\n");

            assert_eq!(
                entries_of(&[("src/a.rs", &text)]),
                Vec::<String>::new(),
                "{text}"
            );
        }
    }

    #[test]
    fn character_literals_and_lifetimes_do_not_end_an_item_early() {
        for body in [
            "fn a() { let c = '}'; }\n",
            "fn a() { let c = '\\''; }\n",
            "fn a() { let c = b'}'; }\n",
            "fn a() { let c = '\\u{1F600}'; }\n",
            "fn a<'a>(x: &'a str) -> &'a str { x }\n",
        ] {
            let text = format!("#[test]\n{body}fn after() {{}}\n");
            let dir = repository(&[("src/a.rs", &text)]);
            let found = in_file_test_hashes(
                dir.path(),
                &["src/a.rs".to_string()],
                crate::overlays::is_test_file,
            );
            let item = format!("#[test]\n{}", body.trim_end());

            assert_eq!(found.len(), 1, "{body}");
            assert_eq!(found["src/a.rs#0"], sha256_hex(item.as_bytes()), "{body}");
        }
    }

    #[test]
    fn test_attribute_forms_are_recognised() {
        for text in [
            "#[cfg( test )]\nfn a() {}\n",
            "#[cfg(all(test, unix))]\nfn a() {}\n",
            "#[cfg(\n    test\n)]\nfn a() {}\n",
            "#[inline]\n/// doc\n#[test]\nfn a() {}\n",
            "#[test]\nfn a() {}",
        ] {
            assert_eq!(
                entries_of(&[("src/a.rs", text)]),
                vec!["src/a.rs#0"],
                "{text}"
            );
        }

        assert!(entries_of(&[("src/a.rs", "fn a() {}\n")]).is_empty());
        assert!(entries_of(&[("tests/a.rs", "#[test]\nfn a() {}\n")]).is_empty());
    }

    #[test]
    fn declared_modules_resolve_to_listed_files_only() {
        assert_eq!(
            entries_of(&[
                (
                    "src/lib.rs",
                    "#[cfg(test)]\nmod one;\n#[cfg(test)]\nmod two;\n#[cfg(test)]\nmod three;\n"
                ),
                ("src/one.rs", "fn one() {}\n"),
                ("src/two/mod.rs", "fn two() {}\n"),
            ]),
            vec![
                "src/lib.rs#0",
                "src/lib.rs#1",
                "src/lib.rs#2",
                "src/one.rs#file",
                "src/two/mod.rs#file",
            ]
        );

        assert_eq!(
            entries_of(&[
                ("src/lib.rs", "mod outer;\n"),
                ("src/outer.rs", "#[cfg(test)]\npub(crate) mod inner;\n"),
                ("src/outer/inner.rs", "fn x() {}\n"),
                ("src/inner.rs", "fn y() {}\n"),
            ]),
            vec!["src/outer.rs#0", "src/outer/inner.rs#file"]
        );

        assert_eq!(
            entries_of(&[
                ("src/lib.rs", "#[cfg(test)]\nmod x;\n"),
                ("src/x.rs", "fn a() {}\n"),
                ("src/deep/x.rs", "fn b() {}\n"),
            ]),
            vec!["src/lib.rs#0", "src/x.rs#file"]
        );
    }

    #[test]
    fn a_declared_file_brings_its_descendants_and_not_a_same_named_file() {
        assert_eq!(
            entries_of(&[
                ("src/lib.rs", "#[cfg(test)]\nmod t;\n"),
                ("src/t.rs", "mod u;\n"),
                ("src/t/u.rs", "fn a() {}\n"),
                ("src/a/t.rs", "fn b() {}\n"),
            ]),
            vec!["src/lib.rs#0", "src/t.rs#file", "src/t/u.rs#file"]
        );
    }

    #[test]
    fn the_test_files_follow_the_shared_file_cases() {
        let text =
            fs::read_to_string(root().join("fixtures/rust-test-gate/file-cases.json")).unwrap();
        let cases: Vec<Value> = serde_json::from_str(&text).unwrap();

        assert!(cases.len() > 15);

        for case in &cases {
            let files: Vec<(&str, &str)> = case["files"]
                .as_object()
                .unwrap()
                .iter()
                .map(|(path, content)| (path.as_str(), content.as_str().unwrap()))
                .collect();
            let mut found: Vec<String> = entries_of(&files)
                .into_iter()
                .filter_map(|key| key.strip_suffix("#file").map(str::to_string))
                .collect();
            let mut want: Vec<String> = case["test_files"]
                .as_array()
                .unwrap()
                .iter()
                .map(|path| path.as_str().unwrap().to_string())
                .collect();

            found.sort();
            want.sort();

            assert_eq!(found, want, "{}", case["name"]);
        }
    }

    #[test]
    fn real_content_has_one_entry_per_file_with_a_cfg_test_line() {
        let root = root();
        let listed = Command::new("git")
            .arg("-C")
            .arg(&root)
            .args(["ls-files", "--", "app/src-tauri/src"])
            .output()
            .unwrap();

        if !listed.status.success() {
            return;
        }

        let listed: Vec<String> = String::from_utf8(listed.stdout)
            .unwrap()
            .lines()
            .filter(|path| path.ends_with(".rs"))
            .map(str::to_string)
            .collect();
        let grep = Command::new("git")
            .arg("-C")
            .arg(&root)
            .args([
                "grep",
                "-l",
                "-E",
                "^#\\[cfg\\(test\\)\\]",
                "--",
                "app/src-tauri/src",
            ])
            .output()
            .unwrap();
        let mut want: Vec<String> = String::from_utf8(grep.stdout)
            .unwrap()
            .lines()
            .map(|path| format!("{path}#0"))
            .collect();

        want.sort();

        let found: Vec<String> = in_file_test_hashes(&root, &listed, crate::overlays::is_test_file)
            .into_keys()
            .collect();

        assert!(!want.is_empty());
        assert_eq!(found, want);
    }

    fn gate_cases() -> Vec<Value> {
        let text = fs::read_to_string(root().join("fixtures/rust-test-gate/cases.json")).unwrap();

        serde_json::from_str(&text).unwrap()
    }

    #[test]
    fn is_test_attribute_follows_the_shared_test_gate_table() {
        let cases = gate_cases();

        assert!(cases.len() > 20);

        for case in cases {
            let attribute = case["attribute"].as_str().unwrap();
            let inner = &attribute.as_bytes()[2..attribute.len() - 1];

            assert_eq!(
                is_test_attribute(inner),
                case["test"].as_bool().unwrap(),
                "{attribute}"
            );
        }
    }

    #[test]
    fn a_mixed_file_counts_only_items_that_require_test() {
        let text = "#[cfg(all(test, unix))]\nfn a() {}\n#[cfg(any(test, unix))]\nfn b() {}\n#[cfg(test)]\nfn c() {}\n";

        assert_eq!(
            entries_of(&[("src/a.rs", text)]),
            vec!["src/a.rs#0".to_string(), "src/a.rs#1".to_string()]
        );
    }
}
