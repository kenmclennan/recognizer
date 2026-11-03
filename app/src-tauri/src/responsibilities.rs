use std::collections::BTreeMap;
use std::fs;
use std::path::Path;
use std::time::UNIX_EPOCH;

use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::fs_safe::checked_relative;
use crate::repository;

const RESPONSIBILITIES: &str = ".recognizer/responsibilities.json";
const CONFIG: &str = ".recognizer/config.yaml";

#[derive(Debug, Default, PartialEq, Serialize)]
pub struct ResponsibilityFiles {
    pub responsibilities: Option<String>,
    pub config: Option<String>,
    pub refused: Vec<String>,
    pub hashes: BTreeMap<String, String>,
    #[serde(rename = "responsibilitiesModifiedMs")]
    pub responsibilities_modified_ms: Option<f64>,
}

pub type Snapshot = Vec<(String, u128, u64)>;

fn read_optional(folder: &Path, relative: &str, refused: &mut Vec<String>) -> Option<String> {
    fs::symlink_metadata(folder.join(relative)).ok()?;

    match checked_relative(folder, relative)
        .and_then(|path| fs::read_to_string(path).map_err(|error| format!("{relative}: {error}")))
    {
        Ok(text) => Some(text),
        Err(reason) => {
            refused.push(reason);

            None
        }
    }
}

fn module_ids(text: &str) -> Vec<String> {
    serde_json::from_str::<serde_json::Value>(text)
        .ok()
        .and_then(|value| {
            value
                .get("modules")?
                .as_object()
                .map(|modules| modules.keys().cloned().collect())
        })
        .unwrap_or_default()
}

fn scanned_paths(scans: &[serde_json::Value], id: &str) -> Vec<String> {
    let Some(scan) = scans.iter().find(|scan| {
        scan.get("modules")
            .and_then(|modules| modules.as_array())
            .is_some_and(|modules| {
                modules
                    .iter()
                    .any(|module| module.get("id").and_then(|value| value.as_str()) == Some(id))
            })
    }) else {
        return Vec::new();
    };
    let paths: Vec<String> = scan
        .get("files")
        .and_then(|files| files.as_array())
        .map(|files| {
            files
                .iter()
                .filter_map(|file| file.get("path")?.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();

    if paths.iter().any(|path| path == id) {
        return vec![id.to_string()];
    }

    let mut direct: Vec<String> = paths
        .into_iter()
        .filter(|path| path.rsplit_once('/').map_or("", |(parent, _)| parent) == id)
        .collect();

    direct.sort();

    direct
}

fn source_hash(folder: &Path, files: &[String]) -> Result<String, String> {
    let mut contents = Vec::new();

    for file in files {
        let bytes = checked_relative(folder, file)
            .and_then(|path| fs::read(path).map_err(|error| format!("{file}: {error}")))?;

        contents.push(bytes);
    }

    let mut digest = Sha256::new();

    if let [only] = contents.as_slice() {
        digest.update(only);
    } else {
        for (file, bytes) in files.iter().zip(&contents) {
            digest.update(format!("==> {file} <==\n").as_bytes());
            digest.update(bytes);

            if !bytes.ends_with(b"\n") {
                digest.update(b"\n");
            }
        }
    }

    Ok(format!("{:x}", digest.finalize()))
}

pub fn read_responsibilities(folder: &Path) -> ResponsibilityFiles {
    let mut refused = Vec::new();
    let responsibilities = read_optional(folder, RESPONSIBILITIES, &mut refused);
    let config = read_optional(folder, CONFIG, &mut refused);
    let mut hashes = BTreeMap::new();
    let scans: Vec<serde_json::Value> = repository::read_cache(folder)
        .scans
        .iter()
        .filter_map(|scan| serde_json::from_str(&scan.text).ok())
        .collect();

    for id in responsibilities
        .as_deref()
        .map(module_ids)
        .unwrap_or_default()
    {
        let files = scanned_paths(&scans, &id);

        if files.is_empty() {
            continue;
        }

        match source_hash(folder, &files) {
            Ok(hash) => {
                hashes.insert(id, hash);
            }
            Err(reason) => refused.push(reason),
        }
    }

    let responsibilities_modified_ms = checked_relative(folder, RESPONSIBILITIES)
        .ok()
        .and_then(|path| crate::sensors::modified_ms(&path));

    ResponsibilityFiles {
        responsibilities,
        config,
        refused,
        hashes,
        responsibilities_modified_ms,
    }
}

pub fn snapshot(folder: &Path) -> Snapshot {
    [RESPONSIBILITIES, CONFIG]
        .iter()
        .filter_map(|relative| {
            let metadata = fs::metadata(folder.join(relative)).ok()?;
            let modified = metadata
                .modified()
                .ok()?
                .duration_since(UNIX_EPOCH)
                .ok()?
                .as_nanos();

            Some((relative.to_string(), modified, metadata.len()))
        })
        .collect()
}

pub fn snapshot_changed(previous: &Snapshot, next: &Snapshot) -> bool {
    previous != next
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn write_scan(dir: &TempDir, modules: &[&str], files: &[&str]) {
        let modules: Vec<String> = modules
            .iter()
            .map(|id| format!(r#"{{"id":"{id}"}}"#))
            .collect();
        let files: Vec<String> = files
            .iter()
            .map(|path| format!(r#"{{"path":"{path}","hash":"x"}}"#))
            .collect();

        fs::create_dir_all(dir.path().join(".recognizer/cache")).unwrap();
        fs::write(
            dir.path().join(".recognizer/cache/scan.python.json"),
            format!(
                r#"{{"modules":[{}],"files":[{}]}}"#,
                modules.join(","),
                files.join(",")
            ),
        )
        .unwrap();
    }

    fn repo() -> TempDir {
        let dir = TempDir::new().unwrap();

        fs::create_dir_all(dir.path().join(".recognizer")).unwrap();
        fs::write(dir.path().join("a.py"), "print(1)\n").unwrap();
        write_scan(
            &dir,
            &["a.py", "gone.py", "b.py"],
            &["a.py", "gone.py", "b.py"],
        );

        dir
    }

    const PACKAGE_HASH: &str = "8c5ccc8157d9f901a5f999662456b9559edddc914a4c9e5524ef731881cc2429";

    fn package_repo() -> TempDir {
        let dir = TempDir::new().unwrap();

        fs::create_dir_all(dir.path().join(".recognizer")).unwrap();
        fs::create_dir_all(dir.path().join("shop/sub")).unwrap();
        fs::write(dir.path().join("shop/A.kt"), "package shop\n\nclass A\n").unwrap();
        fs::write(dir.path().join("shop/B.kt"), "package shop\n\nclass B").unwrap();
        fs::write(dir.path().join("shop/sub/C.kt"), "package sub\n").unwrap();
        write_scan(
            &dir,
            &["shop", "shop/sub"],
            &["shop/B.kt", "shop/A.kt", "shop/sub/C.kt"],
        );
        fs::write(
            dir.path().join(RESPONSIBILITIES),
            r#"{"schema_version":1,"modules":{"shop":{},"shop/sub":{}}}"#,
        )
        .unwrap();

        dir
    }

    fn sha_of_a() -> String {
        format!("{:x}", Sha256::digest(b"print(1)\n"))
    }

    #[test]
    fn both_files_and_the_source_hashes_are_read() {
        let dir = repo();

        fs::write(
            dir.path().join(RESPONSIBILITIES),
            r#"{"schema_version":1,"modules":{"a.py":{}}}"#,
        )
        .unwrap();
        fs::write(dir.path().join(CONFIG), "describer: {}").unwrap();

        let read = read_responsibilities(dir.path());

        assert!(read.responsibilities.is_some());
        assert!(read.responsibilities_modified_ms.is_some());
        assert_eq!(read.config.as_deref(), Some("describer: {}"));
        assert_eq!(read.hashes.get("a.py"), Some(&sha_of_a()));
        assert!(read.refused.is_empty());
    }

    #[test]
    fn an_absent_file_is_none_and_not_refused() {
        let dir = repo();

        fs::write(
            dir.path().join(RESPONSIBILITIES),
            r#"{"schema_version":1,"modules":{}}"#,
        )
        .unwrap();

        let read = read_responsibilities(dir.path());

        assert!(read.responsibilities_modified_ms.is_some());
        assert!(read.config.is_none());
        assert!(read.refused.is_empty());
        let empty = TempDir::new().unwrap();

        assert_eq!(
            read_responsibilities(empty.path()),
            ResponsibilityFiles::default()
        );
        assert!(read_responsibilities(empty.path())
            .responsibilities_modified_ms
            .is_none());
    }

    #[test]
    fn an_unreadable_module_has_no_hash() {
        let dir = repo();

        fs::write(
            dir.path().join(RESPONSIBILITIES),
            r#"{"schema_version":1,"modules":{"a.py":{},"gone.py":{}}}"#,
        )
        .unwrap();

        let read = read_responsibilities(dir.path());

        assert!(read.hashes.contains_key("a.py"));
        assert!(!read.hashes.contains_key("gone.py"));
        assert_eq!(read.refused.len(), 1);
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_out_of_the_folder_is_refused() {
        let dir = repo();
        let outside = TempDir::new().unwrap();

        fs::write(outside.path().join("secret.py"), "secret").unwrap();
        std::os::unix::fs::symlink(outside.path().join("secret.py"), dir.path().join("b.py"))
            .unwrap();
        fs::write(
            dir.path().join(RESPONSIBILITIES),
            r#"{"schema_version":1,"modules":{"b.py":{}}}"#,
        )
        .unwrap();

        let read = read_responsibilities(dir.path());

        assert!(read.hashes.is_empty());
        assert_eq!(read.refused.len(), 1);
        assert!(read.refused[0].contains("b.py"));
    }

    #[test]
    fn a_package_module_hashes_its_direct_files_in_path_order() {
        let dir = package_repo();
        let read = read_responsibilities(dir.path());

        assert_eq!(
            read.hashes.get("shop").map(String::as_str),
            Some(PACKAGE_HASH)
        );
        assert_eq!(
            read.hashes.get("shop/sub"),
            Some(&format!("{:x}", Sha256::digest(b"package sub\n")))
        );
        assert!(read.refused.is_empty());
    }

    #[test]
    fn a_file_that_is_not_valid_utf8_hashes_its_raw_bytes() {
        let dir = repo();
        let bytes: &[u8] = &[0x70, 0x72, 0xff, 0x0a];

        fs::write(dir.path().join("a.py"), bytes).unwrap();
        fs::write(
            dir.path().join(RESPONSIBILITIES),
            r#"{"schema_version":1,"modules":{"a.py":{}}}"#,
        )
        .unwrap();

        let read = read_responsibilities(dir.path());

        assert_eq!(
            read.hashes.get("a.py"),
            Some(&format!("{:x}", Sha256::digest(bytes)))
        );
    }

    #[test]
    fn editing_a_package_file_changes_its_hash() {
        let dir = package_repo();

        fs::write(dir.path().join("shop/B.kt"), "package shop\n\nclass C").unwrap();

        let read = read_responsibilities(dir.path());

        assert_ne!(
            read.hashes.get("shop").map(String::as_str),
            Some(PACKAGE_HASH)
        );
        assert!(read.hashes.contains_key("shop"));
    }

    #[test]
    fn a_missing_package_file_leaves_only_its_module_without_a_hash() {
        let dir = package_repo();

        fs::remove_file(dir.path().join("shop/A.kt")).unwrap();

        let read = read_responsibilities(dir.path());

        assert!(!read.hashes.contains_key("shop"));
        assert!(read.hashes.contains_key("shop/sub"));
        assert_eq!(read.refused.len(), 1);
    }

    #[cfg(unix)]
    #[test]
    fn a_symlinked_package_file_out_of_the_folder_is_refused() {
        let dir = package_repo();
        let outside = TempDir::new().unwrap();

        fs::write(outside.path().join("secret.kt"), "secret").unwrap();
        fs::remove_file(dir.path().join("shop/A.kt")).unwrap();
        std::os::unix::fs::symlink(
            outside.path().join("secret.kt"),
            dir.path().join("shop/A.kt"),
        )
        .unwrap();

        let read = read_responsibilities(dir.path());

        assert!(!read.hashes.contains_key("shop"));
        assert!(read.hashes.contains_key("shop/sub"));
        assert_eq!(read.refused.len(), 1);
        assert!(read.refused[0].contains("A.kt"));
    }

    #[test]
    fn invalid_json_is_returned_as_text_with_no_hashes() {
        let dir = repo();

        fs::write(dir.path().join(RESPONSIBILITIES), "not json").unwrap();

        let read = read_responsibilities(dir.path());

        assert_eq!(read.responsibilities.as_deref(), Some("not json"));
        assert!(read.hashes.is_empty());
    }

    #[test]
    fn the_snapshot_changes_with_either_file_and_not_with_others() {
        let dir = repo();
        let empty = snapshot(dir.path());

        fs::write(dir.path().join(RESPONSIBILITIES), "1").unwrap();

        let one = snapshot(dir.path());

        assert!(snapshot_changed(&empty, &one));
        assert!(!snapshot_changed(&one, &snapshot(dir.path())));

        fs::write(dir.path().join(CONFIG), "x").unwrap();

        let two = snapshot(dir.path());

        assert!(snapshot_changed(&one, &two));

        fs::write(dir.path().join(".recognizer/policy.yaml"), "p").unwrap();
        fs::create_dir_all(dir.path().join(".recognizer/views")).unwrap();
        fs::write(dir.path().join(".recognizer/views/v.json"), "{}").unwrap();

        assert!(!snapshot_changed(&two, &snapshot(dir.path())));

        fs::write(dir.path().join(RESPONSIBILITIES), "12").unwrap();

        let longer = snapshot(dir.path());

        assert!(snapshot_changed(&two, &longer));

        fs::remove_file(dir.path().join(CONFIG)).unwrap();

        assert!(snapshot_changed(&longer, &snapshot(dir.path())));
    }
}
