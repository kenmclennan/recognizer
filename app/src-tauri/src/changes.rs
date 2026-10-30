use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::SystemTime;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::repository;

const RECOGNIZER_FOLDER: &str = ".recognizer";
const COMMIT_LENGTH: usize = 7;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ChangeKind {
    Modified,
    Added,
    Deleted,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct FileChange {
    pub path: String,
    pub kind: ChangeKind,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Moved {
    pub branch: Option<String>,
    pub commit: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct Changes {
    pub files: Vec<FileChange>,
    pub moved: Option<Moved>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct ScanOrigin {
    pub branch: Option<String>,
    pub commit: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct Origin {
    branch: Option<String>,
    commit: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
struct Selection {
    extensions: Vec<String>,
    skip_directory_names: Vec<String>,
    skip_directory_prefixes: Vec<String>,
    skip_directory_suffixes: Vec<String>,
    skip_directories_containing: Vec<String>,
    skip_file_globs: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct ScannedFile {
    path: String,
    hash: String,
}

#[derive(Debug, Deserialize)]
struct RecordedScan {
    files: Vec<ScannedFile>,
    selection: Selection,
}

type Verified = Arc<Mutex<HashMap<String, (Option<SystemTime>, u64)>>>;

#[derive(Debug, Clone, Default)]
pub struct Baseline {
    hashes: HashMap<String, String>,
    selections: Vec<Selection>,
    verified: Verified,
    branch: Option<String>,
    commit: Option<String>,
}

fn glob_matches(pattern: &str, name: &str) -> bool {
    let parts: Vec<&str> = pattern.split('*').collect();
    let (first, rest) = parts.split_first().unwrap_or((&"", &[]));

    let Some(mut remaining) = name.strip_prefix(first) else {
        return false;
    };

    let Some((last, middle)) = rest.split_last() else {
        return remaining.is_empty();
    };

    for part in middle {
        let Some(at) = remaining.find(part) else {
            return false;
        };

        remaining = &remaining[at + part.len()..];
    }

    remaining.len() >= last.len() && remaining.ends_with(last)
}

impl Selection {
    fn skips_directory(&self, relative_directory: &str, folder: &Path) -> bool {
        let name = relative_directory.rsplit('/').next().unwrap_or("");

        name == RECOGNIZER_FOLDER
            || self
                .skip_directory_names
                .iter()
                .any(|skipped| skipped == name)
            || self
                .skip_directory_prefixes
                .iter()
                .any(|prefix| name.starts_with(prefix.as_str()))
            || self
                .skip_directory_suffixes
                .iter()
                .any(|suffix| name.ends_with(suffix.as_str()))
            || self
                .skip_directories_containing
                .iter()
                .any(|marker| folder.join(relative_directory).join(marker).exists())
    }

    fn accepts_file(&self, name: &str) -> bool {
        self.extensions
            .iter()
            .any(|extension| name.ends_with(extension.as_str()))
            && !self
                .skip_file_globs
                .iter()
                .any(|glob| glob_matches(glob, name))
    }

    fn accepts(&self, relative: &str, folder: &Path) -> bool {
        let mut parts: Vec<&str> = relative.split('/').collect();
        let Some(name) = parts.pop() else {
            return false;
        };
        let mut directory = String::new();

        for part in parts {
            if !directory.is_empty() {
                directory.push('/');
            }

            directory.push_str(part);

            if self.skips_directory(&directory, folder) {
                return false;
            }
        }

        self.accepts_file(name)
    }
}

fn covered(selections: &[Selection], relative: &str, folder: &Path) -> bool {
    selections
        .iter()
        .any(|selection| selection.accepts(relative, folder))
}

fn git_output(folder: &Path, args: &[&str]) -> Option<Vec<u8>> {
    Command::new("git")
        .arg("-C")
        .arg(folder)
        .args(args)
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| output.stdout)
}

fn git_text(folder: &Path, args: &[&str]) -> Option<String> {
    let text = String::from_utf8(git_output(folder, args)?).ok()?;
    let trimmed = text.trim();

    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

fn inside_git(folder: &Path) -> bool {
    git_text(folder, &["rev-parse", "--is-inside-work-tree"]).as_deref() == Some("true")
}

fn head_of(folder: &Path) -> (Option<String>, Option<String>) {
    (
        git_text(folder, &["symbolic-ref", "--short", "-q", "HEAD"]),
        git_text(folder, &["rev-parse", "HEAD"]),
    )
}

fn walk(folder: &Path, relative: &str, selections: &[Selection], found: &mut Vec<String>) {
    let Ok(entries) = fs::read_dir(folder.join(relative)) else {
        return;
    };

    for entry in entries.filter_map(|entry| entry.ok()) {
        let Ok(name) = entry.file_name().into_string() else {
            continue;
        };
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        let path = if relative.is_empty() {
            name.clone()
        } else {
            format!("{relative}/{name}")
        };

        if kind.is_dir() {
            if selections
                .iter()
                .any(|selection| !selection.skips_directory(&path, folder))
            {
                walk(folder, &path, selections, found);
            }
        } else if kind.is_file() {
            found.push(path);
        }
    }
}

fn candidates(folder: &Path, selections: &[Selection]) -> Vec<String> {
    let mut paths = if inside_git(folder) {
        git_output(
            folder,
            &[
                "ls-files",
                "-z",
                "--cached",
                "--others",
                "--exclude-standard",
            ],
        )
        .map(|bytes| {
            String::from_utf8_lossy(&bytes)
                .split('\0')
                .filter(|path| !path.is_empty())
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
    } else {
        let mut found = Vec::new();

        walk(folder, "", selections, &mut found);

        found
    };

    paths.retain(|path| covered(selections, path, folder));
    paths.sort();
    paths.dedup();

    paths
}

fn hash_of(path: &Path) -> Option<String> {
    let bytes = fs::read(path).ok()?;

    Some(format!("{:x}", Sha256::digest(bytes)))
}

pub fn take_origin(folder: &Path) -> Origin {
    let (branch, commit) = if inside_git(folder) {
        head_of(folder)
    } else {
        (None, None)
    };

    Origin { branch, commit }
}

pub fn adopt(origin: &Origin, folder: &Path) -> Baseline {
    let mut hashes = HashMap::new();
    let mut selections = Vec::new();

    for scan in repository::read_cache(folder).scans {
        let Ok(recorded) = serde_json::from_str::<RecordedScan>(&scan.text) else {
            continue;
        };

        for file in recorded.files {
            hashes.insert(file.path, file.hash);
        }

        selections.push(recorded.selection);
    }

    Baseline {
        hashes,
        selections,
        verified: Verified::default(),
        branch: origin.branch.clone(),
        commit: origin.commit.clone(),
    }
}

pub fn origin_of(baseline: &Baseline) -> ScanOrigin {
    ScanOrigin {
        branch: baseline.branch.clone(),
        commit: baseline.commit.as_deref().map(short),
    }
}

fn short(commit: &str) -> String {
    commit.chars().take(COMMIT_LENGTH).collect()
}

fn moved_since(baseline: &Baseline, folder: &Path) -> Option<Moved> {
    let before = baseline.commit.as_deref()?;
    let (branch, commit) = head_of(folder);
    let commit = commit?;

    (commit != before || branch != baseline.branch).then(|| Moved {
        branch,
        commit: short(&commit),
    })
}

fn differs(folder: &Path, path: &str, recorded: &str, verified: &Verified) -> bool {
    let full = folder.join(path);
    let Some(metadata) = fs::metadata(&full).ok().filter(|m| m.is_file()) else {
        return false;
    };
    let stamp = (metadata.modified().ok(), metadata.len());

    if verified
        .lock()
        .is_ok_and(|seen| seen.get(path) == Some(&stamp))
    {
        return false;
    }

    match hash_of(&full) {
        Some(hash) if hash == recorded => {
            if let Ok(mut seen) = verified.lock() {
                seen.insert(path.to_string(), stamp);
            }

            false
        }
        Some(_) => true,
        None => false,
    }
}

pub fn compare(folder: &Path, baseline: &Baseline) -> Changes {
    let mut files: BTreeMap<String, ChangeKind> = BTreeMap::new();

    for (path, recorded) in &baseline.hashes {
        if !fs::metadata(folder.join(path)).is_ok_and(|m| m.is_file()) {
            files.insert(path.clone(), ChangeKind::Deleted);
        } else if differs(folder, path, recorded, &baseline.verified) {
            files.insert(path.clone(), ChangeKind::Modified);
        }
    }

    for path in candidates(folder, &baseline.selections) {
        if !baseline.hashes.contains_key(&path) {
            files.insert(path, ChangeKind::Added);
        }
    }

    Changes {
        files: files
            .into_iter()
            .map(|(path, kind)| FileChange { path, kind })
            .collect(),
        moved: moved_since(baseline, folder),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use tempfile::TempDir;

    fn write(dir: &Path, relative: &str, text: &str) {
        let path = dir.join(relative);

        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }

    fn git(dir: &Path, args: &[&str]) {
        let status = Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(["-c", "user.email=t@example.com", "-c", "user.name=t"])
            .args(["-c", "commit.gpgsign=false"])
            .args(args)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .unwrap();

        assert!(status.success(), "git {args:?} failed");
    }

    fn repo() -> TempDir {
        let dir = TempDir::new().unwrap();

        git(dir.path(), &["init", "-q", "-b", "main"]);
        write(dir.path(), "app/a.py", "a = 1\n");
        write(dir.path(), "app/b.py", "b = 1\n");
        write(dir.path(), "web/c.ts", "export const c = 1;\n");
        git(dir.path(), &["add", "."]);
        git(dir.path(), &["commit", "-q", "-m", "first"]);

        dir
    }

    fn expected_scan(language: &str) -> serde_json::Value {
        let text = fs::read_to_string(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../../fixtures")
                .join(language)
                .join("expected-scan.json"),
        )
        .unwrap();

        serde_json::from_str(&text).unwrap()
    }

    fn selection_of(language: &str) -> Selection {
        serde_json::from_value(expected_scan(language)["selection"].clone()).unwrap()
    }

    fn record_scan(dir: &Path, language: &str) {
        let selection = selection_of(language);
        let files: Vec<serde_json::Value> = candidates(dir, std::slice::from_ref(&selection))
            .into_iter()
            .map(|path| {
                serde_json::json!({
                    "path": path,
                    "hash": hash_of(&dir.join(&path)).unwrap(),
                })
            })
            .collect();
        let mut scan = expected_scan(language);

        scan["files"] = serde_json::Value::Array(files);

        write(
            dir,
            &format!(".recognizer/cache/scan.{language}.json"),
            &scan.to_string(),
        );
    }

    fn baseline_of(dir: &Path, languages: &[&str]) -> Baseline {
        let origin = take_origin(dir);

        for language in languages {
            record_scan(dir, language);
        }

        adopt(&origin, dir)
    }

    fn paths(changes: &Changes) -> Vec<(String, ChangeKind)> {
        changes
            .files
            .iter()
            .map(|change| (change.path.clone(), change.kind))
            .collect()
    }

    #[test]
    fn an_edit_counts() {
        let dir = repo();
        let baseline = baseline_of(dir.path(), &["python", "typescript"]);

        write(dir.path(), "app/a.py", "a = 2\n");

        assert_eq!(
            paths(&compare(dir.path(), &baseline)),
            vec![("app/a.py".to_string(), ChangeKind::Modified)]
        );
    }

    #[test]
    fn an_added_file_in_a_covered_language_counts() {
        let dir = repo();
        let baseline = baseline_of(dir.path(), &["python"]);

        write(dir.path(), "app/new.py", "n = 1\n");

        assert_eq!(
            paths(&compare(dir.path(), &baseline)),
            vec![("app/new.py".to_string(), ChangeKind::Added)]
        );
    }

    #[test]
    fn a_deleted_file_counts() {
        let dir = repo();
        let baseline = baseline_of(dir.path(), &["python"]);

        fs::remove_file(dir.path().join("app/b.py")).unwrap();

        assert_eq!(
            paths(&compare(dir.path(), &baseline)),
            vec![("app/b.py".to_string(), ChangeKind::Deleted)]
        );
    }

    #[test]
    fn a_file_edited_twice_is_one_entry() {
        let dir = repo();
        let baseline = baseline_of(dir.path(), &["python"]);

        write(dir.path(), "app/a.py", "a = 2\n");
        write(dir.path(), "app/a.py", "a = 3\n");

        assert_eq!(compare(dir.path(), &baseline).files.len(), 1);
    }

    #[test]
    fn a_file_edited_and_then_deleted_is_one_deleted_entry() {
        let dir = repo();
        let baseline = baseline_of(dir.path(), &["python"]);

        write(dir.path(), "app/a.py", "a = 2\n");
        fs::remove_file(dir.path().join("app/a.py")).unwrap();

        assert_eq!(
            paths(&compare(dir.path(), &baseline)),
            vec![("app/a.py".to_string(), ChangeKind::Deleted)]
        );
    }

    #[test]
    fn a_new_commit_counts_as_moved() {
        let dir = repo();
        let baseline = baseline_of(dir.path(), &["python"]);

        git(dir.path(), &["commit", "-q", "--allow-empty", "-m", "next"]);

        let changes = compare(dir.path(), &baseline);
        let moved = changes.moved.unwrap();

        assert_eq!(moved.branch.as_deref(), Some("main"));
        assert_eq!(moved.commit.len(), COMMIT_LENGTH);
        assert!(changes.files.is_empty());
    }

    #[test]
    fn a_branch_switch_at_the_same_commit_counts_as_moved() {
        let dir = repo();
        let baseline = baseline_of(dir.path(), &["python"]);

        git(dir.path(), &["checkout", "-q", "-b", "other"]);

        let moved = compare(dir.path(), &baseline).moved.unwrap();

        assert_eq!(moved.branch.as_deref(), Some("other"));
    }

    #[test]
    fn an_unmoved_head_is_not_moved() {
        let dir = repo();
        let baseline = baseline_of(dir.path(), &["python"]);

        assert_eq!(compare(dir.path(), &baseline), Changes::default());
    }

    #[test]
    fn an_edit_made_and_then_reversed_does_not_count() {
        let dir = repo();
        let baseline = baseline_of(dir.path(), &["python"]);

        write(dir.path(), "app/a.py", "a = 2\n");
        std::thread::sleep(std::time::Duration::from_millis(20));
        write(dir.path(), "app/a.py", "a = 1\n");

        assert!(compare(dir.path(), &baseline).files.is_empty());
    }

    #[test]
    fn a_change_under_the_recognizer_folder_does_not_count() {
        let dir = repo();
        let baseline = baseline_of(dir.path(), &["python", "typescript"]);

        write(dir.path(), ".recognizer/cache/current-view.json", "{}");
        write(dir.path(), ".recognizer/views/x.py", "x = 1\n");

        assert!(compare(dir.path(), &baseline).files.is_empty());
        assert!(!selection_of("python").accepts(".recognizer/x.py", dir.path()));
    }

    #[test]
    fn files_the_python_scanner_skips_do_not_count() {
        let dir = repo();
        let baseline = baseline_of(dir.path(), &["python"]);

        write(dir.path(), "app/tests/test_a.py", "x = 1\n");
        write(dir.path(), "app/conftest.py", "x = 1\n");
        write(dir.path(), "app/test_b.py", "x = 1\n");
        write(dir.path(), "app/b_test.py", "x = 1\n");
        write(dir.path(), "app/notes.txt", "x\n");
        write(dir.path(), "venv/pyvenv.cfg", "home = x\n");
        write(dir.path(), "venv/lib/m.py", "x = 1\n");

        assert!(compare(dir.path(), &baseline).files.is_empty());
    }

    #[test]
    fn files_the_typescript_scanner_skips_do_not_count() {
        let dir = repo();
        let baseline = baseline_of(dir.path(), &["typescript"]);

        write(dir.path(), "web/c.test.ts", "x\n");
        write(dir.path(), "web/c.spec.tsx", "x\n");
        write(dir.path(), "web/types.d.ts", "x\n");
        write(dir.path(), "web/__tests__/d.ts", "x\n");
        write(dir.path(), "web/tests/d.ts", "x\n");
        write(dir.path(), "web/readme.md", "x\n");

        assert!(compare(dir.path(), &baseline).files.is_empty());
    }

    #[test]
    fn a_gitignored_new_file_does_not_count() {
        let dir = repo();

        write(dir.path(), ".gitignore", "ignored/\n");

        let baseline = baseline_of(dir.path(), &["python"]);

        write(dir.path(), "ignored/x.py", "x = 1\n");

        assert!(compare(dir.path(), &baseline).files.is_empty());
    }

    #[test]
    fn a_tracked_file_that_a_gitignore_pattern_matches_counts() {
        let dir = repo();

        write(dir.path(), "kept/x.py", "x = 1\n");
        git(dir.path(), &["add", "-f", "kept/x.py"]);
        write(dir.path(), ".gitignore", "kept/\n");

        let baseline = baseline_of(dir.path(), &["python"]);

        write(dir.path(), "kept/x.py", "x = 2\n");

        assert_eq!(
            paths(&compare(dir.path(), &baseline)),
            vec![("kept/x.py".to_string(), ChangeKind::Modified)]
        );
    }

    #[test]
    fn a_new_python_file_does_not_count_when_only_typescript_was_scanned() {
        let dir = repo();
        let baseline = baseline_of(dir.path(), &["typescript"]);

        write(dir.path(), "app/new.py", "n = 1\n");

        assert!(compare(dir.path(), &baseline).files.is_empty());
    }

    #[test]
    fn outside_git_there_is_no_commit_and_changes_are_still_reported() {
        let dir = TempDir::new().unwrap();

        write(dir.path(), "app/a.py", "a = 1\n");
        write(dir.path(), "app/b.py", "b = 1\n");

        let baseline = baseline_of(dir.path(), &["python"]);

        assert_eq!(origin_of(&baseline), ScanOrigin::default());

        write(dir.path(), "app/a.py", "a = 2\n");
        write(dir.path(), "app/c.py", "c = 1\n");

        let changes = compare(dir.path(), &baseline);

        assert_eq!(changes.moved, None);
        assert_eq!(changes.files.len(), 2);
    }

    #[test]
    fn a_mixed_change_lists_exactly_its_files_sorted_by_path() {
        let dir = repo();
        let baseline = baseline_of(dir.path(), &["python"]);

        write(dir.path(), "app/z.py", "z = 1\n");
        write(dir.path(), "app/a.py", "a = 2\n");
        fs::remove_file(dir.path().join("app/b.py")).unwrap();

        assert_eq!(
            paths(&compare(dir.path(), &baseline)),
            vec![
                ("app/a.py".to_string(), ChangeKind::Modified),
                ("app/b.py".to_string(), ChangeKind::Deleted),
                ("app/z.py".to_string(), ChangeKind::Added),
            ]
        );
    }

    #[test]
    fn an_edit_made_between_the_scan_and_adoption_is_reported() {
        let dir = repo();
        let origin = take_origin(dir.path());

        record_scan(dir.path(), "python");
        write(dir.path(), "app/a.py", "a = 2\n");

        let baseline = adopt(&origin, dir.path());

        assert_eq!(
            paths(&compare(dir.path(), &baseline)),
            vec![("app/a.py".to_string(), ChangeKind::Modified)]
        );
    }

    #[test]
    fn a_test_file_new_in_a_directory_the_recorded_selection_skips_does_not_count() {
        let dir = repo();
        let baseline = baseline_of(dir.path(), &["python", "typescript"]);

        write(dir.path(), "app/tests/new.py", "n = 1\n");
        write(dir.path(), "web/__tests__/new.ts", "n\n");
        write(dir.path(), "web/.hidden/new.ts", "n\n");

        assert!(compare(dir.path(), &baseline).files.is_empty());
    }

    #[test]
    fn the_baseline_holds_the_hashes_the_scan_recorded_and_the_origin_taken_before() {
        let dir = repo();
        let origin = take_origin(dir.path());

        record_scan(dir.path(), "python");

        let adopted = adopt(&origin, dir.path());
        let mut recorded: Vec<&String> = adopted.hashes.keys().collect();

        recorded.sort();

        assert_eq!(recorded, vec!["app/a.py", "app/b.py"]);
        assert_eq!(adopted.selections.len(), 1);
        assert_eq!(origin_of(&adopted).commit.unwrap().len(), COMMIT_LENGTH);
    }

    #[test]
    fn a_scan_that_cannot_be_read_contributes_nothing() {
        let dir = repo();

        write(dir.path(), ".recognizer/cache/scan.python.json", "{}");

        let adopted = adopt(&take_origin(dir.path()), dir.path());

        assert!(adopted.hashes.is_empty());
        assert!(adopted.selections.is_empty());
    }

    #[test]
    fn a_verified_file_is_not_read_again_while_its_stamp_holds() {
        let dir = repo();
        let baseline = baseline_of(dir.path(), &["python"]);

        assert!(compare(dir.path(), &baseline).files.is_empty());
        assert_eq!(baseline.verified.lock().unwrap().len(), 2);
    }

    fn fixture(language: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../fixtures")
            .join(language)
            .join("sample")
    }

    fn copy_tree(from: &Path, to: &Path) {
        for entry in fs::read_dir(from).unwrap() {
            let entry = entry.unwrap();
            let target = to.join(entry.file_name());

            if entry.file_type().unwrap().is_dir() {
                fs::create_dir_all(&target).unwrap();
                copy_tree(&entry.path(), &target);
            } else {
                fs::copy(entry.path(), target).unwrap();
            }
        }
    }

    fn assert_fixture_scan_is_a_clean_baseline(language: &str, count: usize) {
        let scan = expected_scan(language);

        assert_eq!(scan["files"].as_array().unwrap().len(), count);

        let copy = TempDir::new().unwrap();

        copy_tree(&fixture(language), copy.path());
        write(
            copy.path(),
            &format!(".recognizer/cache/scan.{language}.json"),
            &scan.to_string(),
        );

        let baseline = adopt(&take_origin(copy.path()), copy.path());

        assert_eq!(baseline.hashes.len(), count);
        assert_eq!(compare(copy.path(), &baseline), Changes::default());
    }

    #[test]
    fn the_python_fixture_scan_compares_clean_against_its_own_files() {
        assert_fixture_scan_is_a_clean_baseline("python", 14);
    }

    #[test]
    fn the_typescript_fixture_scan_compares_clean_against_its_own_files() {
        assert_fixture_scan_is_a_clean_baseline("typescript", 15);
    }

    fn assert_selection_matches_the_scanner_parity_tree(language: &str) {
        let text = fs::read_to_string(
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/selection-parity.json"),
        )
        .unwrap();
        let parity: serde_json::Value = serde_json::from_str(&text).unwrap();
        let dir = TempDir::new().unwrap();

        for path in parity[language]["tree"].as_array().unwrap() {
            write(dir.path(), path.as_str().unwrap(), "");
        }

        let selection = selection_of(language);
        let mut accepted = candidates(dir.path(), std::slice::from_ref(&selection));

        accepted.sort();

        let wanted: Vec<&str> = parity[language]["accepted"]
            .as_array()
            .unwrap()
            .iter()
            .map(|path| path.as_str().unwrap())
            .collect();

        assert_eq!(accepted, wanted);
    }

    #[test]
    fn the_python_selection_accepts_exactly_the_files_the_python_scanner_reads() {
        assert_selection_matches_the_scanner_parity_tree("python");
    }

    #[test]
    fn the_typescript_selection_accepts_exactly_the_files_the_typescript_scanner_reads() {
        assert_selection_matches_the_scanner_parity_tree("typescript");
    }

    #[test]
    fn a_glob_treats_star_as_any_run_of_characters_and_nothing_else() {
        assert!(glob_matches("test_*.py", "test_a.py"));
        assert!(glob_matches("test_*.py", "test_.py"));
        assert!(!glob_matches("test_*.py", "atest_a.py"));
        assert!(glob_matches("*.test.*", ".test.ts"));
        assert!(glob_matches("*.d.ts", "a.d.ts"));
        assert!(!glob_matches("*.d.ts", "a.ts"));
        assert!(glob_matches("conftest.py", "conftest.py"));
        assert!(!glob_matches("conftest.py", "conftest.pyc"));
        assert!(!glob_matches("a?c", "abc"));
    }
}
