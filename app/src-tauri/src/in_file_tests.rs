use std::collections::BTreeMap;
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

fn words(text: &[u8]) -> Vec<&[u8]> {
    let mut found = Vec::new();
    let mut i = 0;

    while i < text.len() {
        if text[i] == b'_' || text[i].is_ascii_alphabetic() {
            let start = i;

            while i < text.len() && is_identifier_byte(text[i]) {
                i += 1;
            }

            found.push(&text[start..i]);
        } else {
            i += 1;
        }
    }

    found
}

fn trim(text: &[u8]) -> &[u8] {
    let start = text
        .iter()
        .position(|b| !is_space(*b))
        .unwrap_or(text.len());
    let end = text
        .iter()
        .rposition(|b| !is_space(*b))
        .map_or(start, |p| p + 1);

    &text[start..end]
}

fn is_test_attribute(inner: &[u8]) -> bool {
    let compact: Vec<u8> = inner.iter().copied().filter(|b| !is_space(*b)).collect();

    if compact == b"test" {
        return true;
    }

    let rest = trim(inner);

    if !rest.starts_with(b"cfg") {
        return false;
    }

    let rest = &rest[3..];
    let rest = &rest[rest
        .iter()
        .position(|b| !is_space(*b))
        .unwrap_or(rest.len())..];

    if !(rest.starts_with(b"(") && rest.ends_with(b")")) || rest.len() < 2 {
        return false;
    }

    let found = words(&rest[1..rest.len() - 1]);

    found.contains(&&b"test"[..]) && !found.contains(&&b"not"[..])
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

fn declared_module(text: &[u8]) -> Option<String> {
    let n = text.len();
    let skip_space = |mut at: usize| {
        while at < n && is_space(text[at]) {
            at += 1;
        }

        at
    };
    let mut i = skip_space(0);

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

    let start = i;

    while i < n && is_identifier_byte(text[i]) {
        i += 1;
    }

    let name = String::from_utf8_lossy(&text[start..i]).into_owned();

    i = skip_space(i);

    (i < n && text[i] == b';').then_some(name)
}

struct Scanned {
    items: Vec<(usize, usize)>,
    file_level: bool,
    modules: Vec<String>,
}

fn scan(data: &[u8]) -> Scanned {
    let mut scanned = Scanned {
        items: Vec::new(),
        file_level: false,
        modules: Vec::new(),
    };
    let mut i = 0;

    while i < data.len() {
        if let Some(skipped) = skip_literal(data, i) {
            i = skipped;
            continue;
        }

        if data[i..].starts_with(b"#![") {
            let end = attribute_end(data, i + 3);

            if is_test_attribute(&data[i + 3..end - 1]) {
                scanned.file_level = true;
            }

            i = end;
            continue;
        }

        if data[i..].starts_with(b"#[") {
            let start = i;
            let mut end = attribute_end(data, i + 2);
            let mut is_test = is_test_attribute(&data[i + 2..end - 1]);
            let mut follow = skip_trivia(data, end);

            while data[follow..].starts_with(b"#[") {
                end = attribute_end(data, follow + 2);
                is_test = is_test || is_test_attribute(&data[follow + 2..end - 1]);
                follow = skip_trivia(data, end);
            }

            if !is_test {
                i = end;
                continue;
            }

            let stop = item_end(data, end);

            scanned.items.push((start, stop));

            if let Some(name) = declared_module(&data[end..stop]) {
                scanned.modules.push(name);
            }

            i = stop.max(end);
            continue;
        }

        i += 1;
    }

    scanned
}

fn split_path(path: &str) -> (&str, &str) {
    path.rsplit_once('/').unwrap_or(("", path))
}

fn stem_of(path: &str) -> &str {
    let (_, name) = split_path(path);

    name.strip_suffix(".rs").unwrap_or(name)
}

fn module_directory(file: &str) -> String {
    let (parent, _) = split_path(file);
    let stem = stem_of(file);

    if matches!(stem, "lib" | "main" | "mod") {
        parent.to_string()
    } else if parent.is_empty() {
        stem.to_string()
    } else {
        format!("{parent}/{stem}")
    }
}

fn module_name_of(file: &str) -> &str {
    let stem = stem_of(file);

    if stem == "mod" {
        let (parent, _) = split_path(file);

        split_path(parent).1
    } else {
        stem
    }
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
    let mut declared: Vec<(&str, String)> = Vec::new();

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

        if scanned.file_level {
            entries.insert(format!("{path}#file"), sha256_hex(&data));
        }

        for name in scanned.modules {
            declared.push((path.as_str(), name));
        }
    }

    for (declaring, name) in declared {
        let directory = module_directory(declaring);
        let prefix = if directory.is_empty() {
            String::new()
        } else {
            format!("{directory}/")
        };

        for path in &sources {
            if !path.starts_with(&prefix) || module_name_of(path) != name {
                continue;
            }

            if let Ok(data) = fs::read(folder.join(path)) {
                entries.insert(format!("{path}#file"), sha256_hex(&data));
            }
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
            vec!["src/deep/x.rs#file", "src/lib.rs#0", "src/x.rs#file"]
        );
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
}
