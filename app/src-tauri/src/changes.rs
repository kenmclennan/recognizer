use std::collections::hash_map::DefaultHasher;
use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::SystemTime;

use serde::Serialize;

const CACHE: &str = ".recognizer/cache";
const LANGUAGES: [&str; 2] = ["python", "typescript"];
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

#[derive(Debug, Clone, PartialEq, Eq)]
struct Stamp {
    modified: Option<SystemTime>,
    size: u64,
    hash: u64,
}

#[derive(Debug, Clone, Default)]
pub struct Baseline {
    stamps: HashMap<String, Stamp>,
    branch: Option<String>,
    commit: Option<String>,
    languages: Vec<String>,
}

fn skipped_directory(language: &str, relative_directory: &str, folder: &Path) -> bool {
    let name = relative_directory.rsplit('/').next().unwrap_or("");

    if name == ".recognizer" || name.starts_with('.') {
        return true;
    }

    match language {
        "python" => {
            matches!(
                name,
                "__pycache__" | "tests" | "dist" | "build" | "node_modules" | "site-packages"
            ) || name.ends_with(".egg-info")
                || folder.join(relative_directory).join("pyvenv.cfg").exists()
        }
        "typescript" => matches!(
            name,
            "node_modules" | "dist" | "build" | "test" | "tests" | "__tests__"
        ),
        _ => true,
    }
}

fn accepted_file(language: &str, name: &str) -> bool {
    match language {
        "python" => {
            name.ends_with(".py")
                && !(name.starts_with("test_")
                    || name.ends_with("_test.py")
                    || name.ends_with("_tests.py")
                    || name == "conftest.py")
        }
        "typescript" => {
            let extension = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]
                .iter()
                .any(|extension| name.ends_with(extension));
            let tested = name.contains(".test.") || name.contains(".spec.");

            extension && !name.ends_with(".d.ts") && !tested
        }
        _ => false,
    }
}

pub fn scanned_file(language: &str, relative: &str, folder: &Path) -> bool {
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

        if skipped_directory(language, &directory, folder) {
            return false;
        }
    }

    accepted_file(language, name)
}

fn covered(languages: &[String], relative: &str, folder: &Path) -> bool {
    languages
        .iter()
        .any(|language| scanned_file(language, relative, folder))
}

pub fn languages_cached(folder: &Path) -> Vec<String> {
    let mut languages: Vec<String> = fs::read_dir(folder.join(CACHE))
        .map(|entries| {
            entries
                .filter_map(|entry| entry.ok()?.file_name().into_string().ok())
                .filter_map(|name| {
                    let language = name.strip_prefix("scan.")?.strip_suffix(".json")?;

                    (!language.is_empty()).then(|| language.to_string())
                })
                .collect()
        })
        .unwrap_or_default();

    languages.sort();

    languages
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

fn walk(folder: &Path, relative: &str, found: &mut Vec<String>) {
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
            if LANGUAGES
                .iter()
                .any(|language| !skipped_directory(language, &path, folder))
            {
                walk(folder, &path, found);
            }
        } else if kind.is_file() {
            found.push(path);
        }
    }
}

fn candidates(folder: &Path, languages: &[String]) -> Vec<String> {
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

        walk(folder, "", &mut found);

        found
    };

    paths.retain(|path| covered(languages, path, folder));
    paths.sort();
    paths.dedup();

    paths
}

fn hash_of(path: &Path) -> Option<u64> {
    let bytes = fs::read(path).ok()?;
    let mut hasher = DefaultHasher::new();

    bytes.hash(&mut hasher);

    Some(hasher.finish())
}

fn stamp_of(path: &Path) -> Option<Stamp> {
    let metadata = fs::metadata(path)
        .ok()
        .filter(|metadata| metadata.is_file())?;

    Some(Stamp {
        modified: metadata.modified().ok(),
        size: metadata.len(),
        hash: hash_of(path)?,
    })
}

pub fn take_baseline(folder: &Path) -> Baseline {
    let all: Vec<String> = LANGUAGES
        .iter()
        .map(|language| language.to_string())
        .collect();
    let stamps = candidates(folder, &all)
        .into_iter()
        .filter_map(|path| Some((path.clone(), stamp_of(&folder.join(&path))?)))
        .collect();
    let (branch, commit) = if inside_git(folder) {
        head_of(folder)
    } else {
        (None, None)
    };

    Baseline {
        stamps,
        branch,
        commit,
        languages: all,
    }
}

pub fn adopt(baseline: &Baseline, folder: &Path) -> Baseline {
    let languages = languages_cached(folder);
    let stamps = baseline
        .stamps
        .iter()
        .filter(|(path, _)| covered(&languages, path, folder))
        .map(|(path, stamp)| (path.clone(), stamp.clone()))
        .collect();

    Baseline {
        stamps,
        branch: baseline.branch.clone(),
        commit: baseline.commit.clone(),
        languages,
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

pub fn compare(folder: &Path, baseline: &Baseline) -> Changes {
    let mut files: BTreeMap<String, ChangeKind> = BTreeMap::new();

    for (path, before) in &baseline.stamps {
        match fs::metadata(folder.join(path)).ok().filter(|m| m.is_file()) {
            None => {
                files.insert(path.clone(), ChangeKind::Deleted);
            }
            Some(metadata) => {
                if metadata.modified().ok() == before.modified && metadata.len() == before.size {
                    continue;
                }

                if hash_of(&folder.join(path)).is_some_and(|hash| hash != before.hash) {
                    files.insert(path.clone(), ChangeKind::Modified);
                }
            }
        }
    }

    for path in candidates(folder, &baseline.languages) {
        if !baseline.stamps.contains_key(&path) {
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

    fn baseline_of(dir: &Path, languages: &[&str]) -> Baseline {
        let mut baseline = take_baseline(dir);
        let wanted: Vec<String> = languages.iter().map(|l| l.to_string()).collect();

        baseline
            .stamps
            .retain(|path, _| covered(&wanted, path, dir));
        baseline.languages = wanted;

        baseline
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
        assert!(!scanned_file("python", ".recognizer/x.py", dir.path()));
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
    fn adopting_keeps_only_the_cached_languages() {
        let dir = repo();

        write(dir.path(), ".recognizer/cache/scan.python.json", "{}");

        let adopted = adopt(&take_baseline(dir.path()), dir.path());

        assert_eq!(adopted.languages, vec!["python".to_string()]);
        assert!(adopted.stamps.keys().all(|path| path.ends_with(".py")));
        assert_eq!(origin_of(&adopted).commit.unwrap().len(), COMMIT_LENGTH);
    }

    fn fixture(language: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../fixtures")
            .join(language)
            .join("sample")
    }

    fn expected_modules(language: &str) -> Vec<String> {
        let text = fs::read_to_string(
            fixture(language)
                .parent()
                .unwrap()
                .join("expected-scan.json"),
        )
        .unwrap();
        let value: serde_json::Value = serde_json::from_str(&text).unwrap();
        let mut ids: Vec<String> = value["modules"]
            .as_array()
            .unwrap()
            .iter()
            .map(|module| module["id"].as_str().unwrap().to_string())
            .collect();

        ids.sort();

        ids
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

    fn scanned_set(folder: &Path, language: &str) -> Vec<String> {
        let mut found: Vec<String> = take_baseline(folder)
            .stamps
            .into_keys()
            .filter(|path| scanned_file(language, path, folder))
            .collect();

        found.sort();

        found
    }

    fn assert_matches_fixture(language: &str, count: usize) {
        let expected = expected_modules(language);

        assert_eq!(expected.len(), count);
        assert_eq!(scanned_set(&fixture(language), language), expected);

        let copy = TempDir::new().unwrap();

        copy_tree(&fixture(language), copy.path());

        assert_eq!(scanned_set(copy.path(), language), expected);
    }

    #[test]
    fn the_python_fixture_scans_the_files_its_expected_scan_names() {
        assert_matches_fixture("python", 14);
    }

    #[test]
    fn the_typescript_fixture_scans_the_files_its_expected_scan_names() {
        assert_matches_fixture("typescript", 15);
    }
}
