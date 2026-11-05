use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::process::Command;

use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::fs_safe::checked_relative;
use crate::sensors::modified_ms;

pub const OVERLAYS: &str = ".recognizer/cache/overlays";

#[derive(Debug, PartialEq, Serialize)]
pub struct OverlayFile {
    pub name: String,
    pub text: String,
    #[serde(rename = "modifiedMs")]
    pub modified_ms: Option<f64>,
}

#[derive(Debug, Default, PartialEq, Serialize)]
pub struct OverlaysRead {
    pub files: Vec<OverlayFile>,
    pub refused: Vec<String>,
}

pub fn overlay_names(folder: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(folder.join(OVERLAYS))
        .map(|entries| {
            entries
                .filter_map(|entry| entry.ok()?.file_name().into_string().ok())
                .filter_map(|file| file.strip_suffix(".json").map(str::to_string))
                .collect()
        })
        .unwrap_or_default();

    names.sort();

    names
}

pub fn read_overlays(folder: &Path) -> OverlaysRead {
    let mut read = OverlaysRead::default();

    for name in overlay_names(folder) {
        let relative = format!("{OVERLAYS}/{name}.json");

        match checked_relative(folder, &relative).and_then(|path| {
            let modified_ms = modified_ms(&path);

            fs::read_to_string(path)
                .map(|text| (text, modified_ms))
                .map_err(|error| format!("{relative}: {error}"))
        }) {
            Ok((text, modified_ms)) => read.files.push(OverlayFile {
                name,
                text,
                modified_ms,
            }),
            Err(_) => read.refused.push(name),
        }
    }

    read
}

const TEST_DIRECTORIES: [&str; 3] = ["test", "tests", "__tests__"];
const SCRIPT_EXTENSIONS: [&str; 5] = ["ts", "tsx", "js", "jsx", "mjs"];

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

    if is_test_basename(basename) {
        return true;
    }

    let stem = stem_of(basename);

    stem.ends_with("Test") || stem.ends_with("Tests")
}

fn listed_files(folder: &Path) -> Vec<String> {
    let output = Command::new("git")
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
        .output();

    match output {
        Ok(output) if output.status.success() => output
            .stdout
            .split(|byte| *byte == 0)
            .filter(|path| !path.is_empty())
            .filter_map(|path| String::from_utf8(path.to_vec()).ok())
            .collect(),
        _ => Vec::new(),
    }
}

pub fn tests_hash(folder: &Path, known: &HashMap<String, String>) -> String {
    let mut paths: Vec<String> = listed_files(folder)
        .into_iter()
        .filter(|path| is_test_file(path))
        .collect();

    paths.sort();
    paths.dedup();

    let mut lines = String::new();

    for path in paths {
        let digest = known
            .get(&path)
            .filter(|digest| !digest.is_empty())
            .cloned()
            .or_else(|| {
                fs::read(folder.join(&path))
                    .ok()
                    .map(|bytes| format!("{:x}", Sha256::digest(bytes)))
            });

        if let Some(digest) = digest {
            lines.push_str(&format!("{path}\t{digest}\n"));
        }
    }

    format!("{:x}", Sha256::digest(lines.as_bytes()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;
    use tempfile::TempDir;

    const WORKED: &str = "9a49fc96a1cf8fd7663d83897d346b14a4f4de85c8114981854191414ab6df5a";
    const EMPTY: &str = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

    fn sha(text: &str) -> String {
        format!("{:x}", Sha256::digest(text.as_bytes()))
    }

    fn repository(files: &[(&str, &str)]) -> TempDir {
        let dir = TempDir::new().unwrap();

        Command::new("git")
            .arg("-C")
            .arg(dir.path())
            .arg("init")
            .arg("-q")
            .status()
            .unwrap();

        for (name, text) in files {
            let target = dir.path().join(name);

            fs::create_dir_all(target.parent().unwrap()).unwrap();
            fs::write(target, text).unwrap();
        }

        dir
    }

    #[test]
    fn is_test_file_agrees_with_the_shared_fixture() {
        let text = fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../fixtures/sensors/test-files.json"
        ))
        .unwrap();
        let cases: Vec<Value> = serde_json::from_str(&text).unwrap();

        assert!(cases.len() > 10);

        for case in cases {
            let path = case["path"].as_str().unwrap();

            assert_eq!(
                is_test_file(path),
                case["test"].as_bool().unwrap(),
                "{path}"
            );
        }
    }

    #[test]
    fn tests_hash_of_the_worked_example_repository_is_the_sensors_digest() {
        let dir = repository(&[("tests/a.py", "a"), ("tests/b.py", "b")]);

        assert_eq!(tests_hash(dir.path(), &HashMap::new()), WORKED);
    }

    #[test]
    fn tests_hash_outside_git_is_the_digest_of_the_empty_list() {
        let dir = TempDir::new().unwrap();

        fs::create_dir_all(dir.path().join("tests")).unwrap();
        fs::write(dir.path().join("tests/a.py"), "a").unwrap();

        assert_eq!(tests_hash(dir.path(), &HashMap::new()), EMPTY);
    }

    #[test]
    fn tests_hash_takes_a_known_hash_over_the_disk_and_reads_the_disk_otherwise() {
        let dir = repository(&[("tests/a.py", "a"), ("tests/b.py", "b"), ("src/c.py", "c")]);
        let known: HashMap<String, String> = [
            ("tests/a.py".to_string(), "known-a".to_string()),
            ("src/c.py".to_string(), "ignored".to_string()),
        ]
        .into();

        let expected = sha(&format!("tests/a.py\tknown-a\ntests/b.py\t{}\n", sha("b")));

        assert_eq!(tests_hash(dir.path(), &known), expected);
    }

    #[test]
    fn tests_hash_skips_a_file_it_cannot_read() {
        use std::os::unix::fs::PermissionsExt;

        let dir = repository(&[("tests/a.py", "a"), ("tests/b.py", "b")]);
        let secret = dir.path().join("tests/b.py");

        fs::set_permissions(&secret, fs::Permissions::from_mode(0o000)).unwrap();

        if fs::read(&secret).is_ok() {
            return;
        }

        let expected = sha(&format!("tests/a.py\t{}\n", sha("a")));

        assert_eq!(tests_hash(dir.path(), &HashMap::new()), expected);
    }

    fn overlay_path(dir: &TempDir, name: &str) -> std::path::PathBuf {
        dir.path().join(OVERLAYS).join(format!("{name}.json"))
    }

    #[test]
    fn read_overlays_returns_every_json_file_sorted_and_refuses_a_symlink_out() {
        let dir = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();

        fs::create_dir_all(dir.path().join(OVERLAYS)).unwrap();
        fs::write(overlay_path(&dir, "crap"), "one").unwrap();
        fs::write(overlay_path(&dir, "coverage"), "two").unwrap();
        fs::write(dir.path().join(OVERLAYS).join("notes.txt"), "no").unwrap();
        fs::write(outside.path().join("x.json"), "secret").unwrap();
        std::os::unix::fs::symlink(outside.path().join("x.json"), overlay_path(&dir, "evil"))
            .unwrap();

        let read = read_overlays(dir.path());

        assert!(read.files.iter().all(|file| file.modified_ms.is_some()));
        assert_eq!(
            read.files,
            vec![
                OverlayFile {
                    name: "coverage".into(),
                    text: "two".into(),
                    modified_ms: read.files[0].modified_ms,
                },
                OverlayFile {
                    name: "crap".into(),
                    text: "one".into(),
                    modified_ms: read.files[1].modified_ms,
                },
            ]
        );
        assert_eq!(read.refused, vec!["evil".to_string()]);
    }

    #[test]
    fn read_overlays_of_a_repository_without_the_folder_is_empty() {
        assert_eq!(
            read_overlays(TempDir::new().unwrap().path()),
            OverlaysRead::default()
        );
    }
}
