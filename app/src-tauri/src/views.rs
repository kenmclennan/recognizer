use std::collections::VecDeque;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, UNIX_EPOCH};

use serde::Serialize;

use crate::fs_safe::{checked_relative, write_atomic};
use crate::repository::{self, ScanFile, ScanReport};
use crate::tool_runner::{runner, Flights, ToolRunner};

const VIEWS: &str = ".recognizer/views";

#[derive(Debug, PartialEq, Serialize)]
pub struct ViewFile {
    pub name: String,
    pub text: String,
}

#[derive(Debug, Default, PartialEq, Serialize)]
pub struct ViewList {
    pub views: Vec<ViewFile>,
    pub refused: Vec<String>,
}

#[derive(Debug, PartialEq, Serialize)]
pub struct Rename {
    pub from: String,
    pub to: String,
}

pub type Snapshot = Vec<(String, u128, u64)>;

pub fn valid_name(name: &str) -> bool {
    let mut characters = name.chars();

    name.len() <= 64
        && characters
            .next()
            .is_some_and(|first| first.is_ascii_alphanumeric())
        && characters.all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

pub fn valid_commit(commit: &str) -> bool {
    (7..=64).contains(&commit.len())
        && commit
            .chars()
            .all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c))
}

fn view_name(file: &str) -> Option<&str> {
    file.strip_suffix(".json").filter(|stem| valid_name(stem))
}

pub fn list_views(folder: &Path) -> ViewList {
    let mut list = ViewList::default();
    let mut names: Vec<String> = fs::read_dir(folder.join(VIEWS))
        .map(|entries| {
            entries
                .filter_map(|entry| entry.ok()?.file_name().into_string().ok())
                .filter(|file| view_name(file).is_some())
                .collect()
        })
        .unwrap_or_default();

    names.sort();

    for file in names {
        let relative = format!("{VIEWS}/{file}");

        match checked_relative(folder, &relative).and_then(|path| {
            fs::read_to_string(path).map_err(|error| format!("{relative}: {error}"))
        }) {
            Ok(text) => list.views.push(ViewFile {
                name: file.trim_end_matches(".json").to_string(),
                text,
            }),
            Err(reason) => list.refused.push(reason),
        }
    }

    list
}

pub fn write_view(folder: &Path, name: &str, text: &str) -> Result<(), String> {
    if !valid_name(name) {
        return Err(format!("{name:?} is not a valid view name"));
    }

    serde_json::from_str::<serde_json::Value>(text)
        .map_err(|error| format!("the view is not valid JSON: {error}"))?;

    write_atomic(&folder.join(VIEWS).join(format!("{name}.json")), text)
        .map_err(|error| error.to_string())
}

pub fn rename_view(folder: &Path, from: &str, to: &str) -> Result<(), String> {
    for name in [from, to] {
        if !valid_name(name) {
            return Err(format!("{name:?} is not a valid view name"));
        }
    }

    let views = folder.join(VIEWS);
    let source = views.join(format!("{from}.json"));
    let target = views.join(format!("{to}.json"));

    if !source.is_file() {
        return Err(format!("there is no view named {from}"));
    }

    if target.exists() {
        return Err(format!("{to} already exists"));
    }

    fs::rename(source, target).map_err(|error| error.to_string())
}

pub fn valid_ref(reference: &str) -> bool {
    let mut characters = reference.chars();

    !reference.contains("..")
        && characters
            .next()
            .is_some_and(|first| first.is_ascii_alphanumeric() || first == '_')
        && characters.all(|c| c.is_ascii_alphanumeric() || "_./@+-".contains(c))
}

#[derive(Debug, PartialEq, Serialize)]
pub struct FileChange {
    pub status: String,
    pub path: String,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeRange {
    pub base_commit: Option<String>,
    pub head_commit: Option<String>,
    pub merged: bool,
    pub changes: Vec<FileChange>,
}

pub fn parse_name_status(output: &str) -> Vec<FileChange> {
    let mut fields = output.split('\0');
    let mut changes = Vec::new();

    while let (Some(status), Some(path)) = (fields.next(), fields.next()) {
        if matches!(status, "A" | "M" | "D" | "T") {
            changes.push(FileChange {
                status: status.to_string(),
                path: path.to_string(),
            });
        }
    }

    changes
}

fn git_in(folder: &Path, args: &[&str]) -> Option<std::process::Output> {
    Command::new("git")
        .arg("-C")
        .arg(folder)
        .args(args)
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .ok()
}

fn resolve_ref(folder: &Path, reference: &str) -> Result<Option<String>, ()> {
    let output = git_in(
        folder,
        &[
            "rev-parse",
            "--verify",
            "-q",
            &format!("{reference}^{{commit}}"),
        ],
    )
    .ok_or(())?;

    match output.status.code() {
        Some(0) => {
            let commit = String::from_utf8_lossy(&output.stdout).trim().to_string();

            Ok((!commit.is_empty()).then_some(commit))
        }
        Some(1) => Ok(None),
        _ => Err(()),
    }
}

pub fn change_range(folder: &Path, base: &str, head: &str) -> Option<ChangeRange> {
    if !valid_ref(base) || !valid_ref(head) {
        return None;
    }

    let base_commit = resolve_ref(folder, base).ok()?;
    let head_commit = resolve_ref(folder, head).ok()?;
    let (Some(b), Some(h)) = (&base_commit, &head_commit) else {
        return Some(ChangeRange {
            base_commit,
            head_commit,
            merged: false,
            changes: Vec::new(),
        });
    };
    let merged = h != b
        && git_in(folder, &["merge-base", "--is-ancestor", h, b])
            .is_some_and(|output| output.status.success());
    let diff = git_in(
        folder,
        &[
            "diff",
            "--no-renames",
            "--name-status",
            "-z",
            &format!("{b}...{h}"),
        ],
    )
    .filter(|output| output.status.success())?;

    Some(ChangeRange {
        merged,
        changes: parse_name_status(&String::from_utf8_lossy(&diff.stdout)),
        base_commit,
        head_commit,
    })
}

pub fn remove_view(folder: &Path, name: &str) -> Result<(), String> {
    if !valid_name(name) {
        return Err(format!("{name:?} is not a valid view name"));
    }

    let path = view_file(folder, name);
    let metadata =
        fs::symlink_metadata(&path).map_err(|_| format!("there is no view named {name}"))?;

    if !metadata.is_file() {
        return Err(format!("{name} is not a plain view file"));
    }

    fs::remove_file(path).map_err(|error| error.to_string())
}

pub fn view_file(folder: &Path, name: &str) -> PathBuf {
    folder.join(VIEWS).join(format!("{name}.json"))
}

pub fn view_link(folder: &Path, name: &str) -> Result<String, String> {
    if !valid_name(name) {
        return Err(format!("{name:?} is not a valid view name"));
    }

    Ok(crate::link::build(folder, name))
}

pub fn parse_renames(output: &str) -> Vec<Rename> {
    let mut fields = output.split('\0').filter(|field| !field.is_empty());
    let mut renames = Vec::new();

    while let Some(status) = fields.next() {
        if status.starts_with('R') {
            if let (Some(from), Some(to)) = (fields.next(), fields.next()) {
                renames.push(Rename {
                    from: from.to_string(),
                    to: to.to_string(),
                });
            }
        } else {
            fields.next();
        }
    }

    renames
}

pub fn renames_since(folder: &Path, commit: &str) -> Vec<Rename> {
    if !valid_commit(commit) {
        return Vec::new();
    }

    Command::new("git")
        .arg("-C")
        .arg(folder)
        .args([
            "diff",
            "-M",
            "--relative",
            "--name-status",
            "--diff-filter=R",
            "-z",
            commit,
        ])
        .stdin(Stdio::null())
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| parse_renames(&String::from_utf8_lossy(&output.stdout)))
        .unwrap_or_default()
}

const DEFAULT_AUTHOR: &str = "Me";

fn author_from(stdout: &str) -> String {
    let name = stdout.trim();

    if name.is_empty() {
        DEFAULT_AUTHOR.to_string()
    } else {
        name.chars().take(64).collect()
    }
}

pub fn view_author(folder: &Path) -> String {
    Command::new("git")
        .arg("-C")
        .arg(folder)
        .args(["config", "user.name"])
        .stdin(Stdio::null())
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| author_from(&String::from_utf8_lossy(&output.stdout)))
        .unwrap_or_else(|| DEFAULT_AUTHOR.to_string())
}

fn extract_commit(folder: &Path, commit: &str, target: &Path) -> bool {
    let Ok(mut archive) = Command::new("git")
        .arg("-C")
        .arg(folder)
        .args(["archive", commit])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    else {
        return false;
    };
    let Some(stream) = archive.stdout.take() else {
        return false;
    };
    let unpacked = Command::new("tar")
        .arg("-x")
        .arg("-C")
        .arg(target)
        .stdin(stream)
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false);
    let archived = archive
        .wait()
        .map(|status| status.success())
        .unwrap_or(false);

    unpacked && archived
}

const TEMP_PREFIX: &str = "recognizer-at-";
const MEMO_LIMIT: usize = 16;
const MEMO_FOUND: Duration = Duration::from_secs(600);
const MEMO_EMPTY: Duration = Duration::from_secs(60);
const STALE_TEMP: Duration = Duration::from_secs(3600);

struct TempScan(PathBuf);

impl TempScan {
    fn create(root: &Path) -> Option<TempScan> {
        static NEXT: AtomicU64 = AtomicU64::new(0);

        let nanos = std::time::SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|elapsed| elapsed.as_nanos())
            .unwrap_or(0);
        let target = root.join(format!(
            "{TEMP_PREFIX}{}-{nanos}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));

        fs::create_dir_all(&target).ok()?;

        Some(TempScan(target))
    }
}

impl Drop for TempScan {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

pub fn sweep_stale(root: &Path, max_age: Duration) {
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };

    for entry in entries.filter_map(Result::ok) {
        let stale = entry.file_name().to_string_lossy().starts_with(TEMP_PREFIX)
            && entry
                .metadata()
                .and_then(|metadata| metadata.modified())
                .ok()
                .and_then(|modified| modified.elapsed().ok())
                .is_some_and(|age| age > max_age);

        if stale {
            let _ = fs::remove_dir_all(entry.path());
        }
    }
}

pub fn sweep_stale_temp_dirs() {
    sweep_stale(&std::env::temp_dir(), STALE_TEMP);
}

pub fn scans_in(
    root: &Path,
    folder: &Path,
    commit: &str,
    runner: &ToolRunner,
    command: &str,
) -> Option<Vec<ScanFile>> {
    if !valid_commit(commit) {
        return None;
    }

    let temp = TempScan::create(root)?;

    if !extract_commit(folder, commit, &temp.0) {
        return None;
    }

    match repository::scan_with(runner, &temp.0, command) {
        ScanReport::Scanned { scans, .. } if !scans.is_empty() => Some(scans),
        _ => None,
    }
}

type Comparison = Option<Vec<ScanFile>>;

#[derive(Default)]
pub struct Comparisons {
    flights: Flights<Comparison>,
    memo: Mutex<VecDeque<(String, Instant, Comparison)>>,
}

impl Comparisons {
    fn remembered(&self, key: &str) -> Option<Comparison> {
        let mut memo = self.memo.lock().unwrap_or_else(|error| error.into_inner());

        memo.retain(|(_, at, found)| {
            at.elapsed()
                < if found.is_some() {
                    MEMO_FOUND
                } else {
                    MEMO_EMPTY
                }
        });

        memo.iter()
            .find(|(remembered, _, _)| remembered == key)
            .map(|(_, _, found)| found.clone())
    }

    fn remember(&self, key: String, found: &Comparison) {
        let mut memo = self.memo.lock().unwrap_or_else(|error| error.into_inner());

        memo.push_back((key, Instant::now(), found.clone()));

        while memo.len() > MEMO_LIMIT {
            memo.pop_front();
        }
    }

    pub fn scans(
        &self,
        root: &Path,
        folder: &Path,
        commit: &str,
        runner: &ToolRunner,
        command: &str,
    ) -> Comparison {
        let key = format!("{}\0{commit}", folder.display());

        if let Some(found) = self.remembered(&key) {
            return found;
        }

        self.flights.run(&key, || {
            if let Some(found) = self.remembered(&key) {
                return found;
            }

            let found = scans_in(root, folder, commit, runner, command);

            self.remember(key.clone(), &found);

            found
        })
    }
}

pub fn scans_at(folder: &Path, commit: &str) -> Option<Vec<ScanFile>> {
    static COMPARISONS: OnceLock<Comparisons> = OnceLock::new();

    COMPARISONS.get_or_init(Comparisons::default).scans(
        &std::env::temp_dir(),
        folder,
        commit,
        runner(),
        repository::RECOGNIZER_COMMAND,
    )
}

pub fn snapshot(folder: &Path) -> Snapshot {
    let mut files: Snapshot = fs::read_dir(folder.join(VIEWS))
        .map(|entries| {
            entries
                .filter_map(|entry| {
                    let entry = entry.ok()?;
                    let name = entry.file_name().into_string().ok()?;
                    let metadata = entry.metadata().ok()?;
                    let modified = metadata
                        .modified()
                        .ok()?
                        .duration_since(UNIX_EPOCH)
                        .ok()?
                        .as_nanos();

                    Some((name, modified, metadata.len()))
                })
                .collect()
        })
        .unwrap_or_default();

    files.sort();

    files
}

pub fn snapshot_changed(previous: &Snapshot, next: &Snapshot) -> bool {
    previous != next
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tool_runner::tests::{
        runner_with, script, shell_running_the_script, working_runner,
    };
    use tempfile::TempDir;

    fn repo() -> TempDir {
        let dir = TempDir::new().unwrap();

        fs::create_dir_all(dir.path().join(VIEWS)).unwrap();

        dir
    }

    #[test]
    fn names_that_could_leave_the_views_folder_are_rejected() {
        assert!(valid_name("overview"));
        assert!(valid_name("a_b-1"));
        assert!(valid_name(&"a".repeat(64)));
        assert!(!valid_name("../x"));
        assert!(!valid_name("a/b"));
        assert!(!valid_name(""));
        assert!(!valid_name(&"a".repeat(65)));
        assert!(!valid_name("-leading"));
        assert!(!valid_name("dot.json"));
    }

    #[test]
    fn commits_that_could_act_as_options_are_rejected() {
        assert!(valid_commit("abcdef1"));
        assert!(valid_commit(&"a1".repeat(32)));
        assert!(!valid_commit("--output=x"));
        assert!(!valid_commit("ABCDEF1"));
        assert!(!valid_commit("abc12"));
        assert!(!valid_commit(&"a".repeat(65)));
    }

    #[test]
    fn write_view_rejects_a_bad_name_and_bad_json() {
        let dir = repo();

        assert!(write_view(dir.path(), "../x", "{}").is_err());
        assert!(write_view(dir.path(), "ok", "not json").is_err());
        assert!(!dir.path().join(VIEWS).join("ok.json").exists());
    }

    #[test]
    fn write_view_leaves_no_temporary_file() {
        let dir = repo();

        write_view(dir.path(), "overview", "{\"a\": 1}\n").unwrap();

        let names: Vec<String> = fs::read_dir(dir.path().join(VIEWS))
            .unwrap()
            .map(|entry| entry.unwrap().file_name().into_string().unwrap())
            .collect();

        assert_eq!(names, vec!["overview.json".to_string()]);
        assert_eq!(
            fs::read_to_string(dir.path().join(VIEWS).join("overview.json")).unwrap(),
            "{\"a\": 1}\n"
        );
    }

    #[test]
    fn rename_view_moves_the_file() {
        let dir = repo();

        write_view(dir.path(), "overview", "{\"a\": 1}\n").unwrap();
        rename_view(dir.path(), "overview", "summary").unwrap();

        assert!(!dir.path().join(VIEWS).join("overview.json").exists());
        assert_eq!(
            fs::read_to_string(dir.path().join(VIEWS).join("summary.json")).unwrap(),
            "{\"a\": 1}\n"
        );
    }

    #[test]
    fn rename_view_rejects_bad_names_and_an_existing_target() {
        let dir = repo();

        write_view(dir.path(), "one", "{}").unwrap();
        write_view(dir.path(), "two", "{}").unwrap();

        assert!(rename_view(dir.path(), "one", "../x").is_err());
        assert!(rename_view(dir.path(), "../one", "three").is_err());
        assert!(rename_view(dir.path(), "one", "two").is_err());
        assert!(rename_view(dir.path(), "missing", "three").is_err());
        assert!(dir.path().join(VIEWS).join("one.json").exists());
        assert!(dir.path().join(VIEWS).join("two.json").exists());
    }

    #[test]
    fn list_views_reads_matching_names_only() {
        let dir = repo();
        let views = dir.path().join(VIEWS);

        fs::write(views.join("a.json"), "A").unwrap();
        fs::write(views.join("b.json"), "B").unwrap();
        fs::write(views.join("not a name.json"), "x").unwrap();
        fs::write(views.join("notes.txt"), "x").unwrap();

        let list = list_views(dir.path());

        assert_eq!(
            list.views,
            vec![
                ViewFile {
                    name: "a".to_string(),
                    text: "A".to_string()
                },
                ViewFile {
                    name: "b".to_string(),
                    text: "B".to_string()
                },
            ]
        );
        assert!(list.refused.is_empty());
    }

    #[test]
    fn no_views_folder_is_an_empty_list() {
        let dir = TempDir::new().unwrap();

        assert_eq!(list_views(dir.path()), ViewList::default());
    }

    #[cfg(unix)]
    #[test]
    fn list_views_skips_a_symlink_out_of_the_folder_and_names_it() {
        let dir = TempDir::new().unwrap();
        let root = dir.path().join("repo");
        let views = root.join(VIEWS);

        fs::create_dir_all(&views).unwrap();
        fs::write(dir.path().join("secret.json"), "secret").unwrap();
        fs::write(views.join("a.json"), "A").unwrap();
        std::os::unix::fs::symlink(dir.path().join("secret.json"), views.join("evil.json"))
            .unwrap();

        let list = list_views(&root);

        assert_eq!(list.views.len(), 1);
        assert_eq!(list.refused.len(), 1);
        assert!(list.refused[0].contains("evil.json"));
    }

    #[test]
    fn view_link_names_the_folder_and_validates_the_view() {
        let dir = repo();
        let link = view_link(dir.path(), "overview").unwrap();

        assert!(link.starts_with("recognizer://open?repo=%2F"));
        assert!(link.ends_with("&view=overview"));
        assert!(view_link(dir.path(), "../x").is_err());
    }

    #[test]
    fn a_snapshot_changes_when_a_file_is_written_or_removed() {
        let dir = repo();
        let views = dir.path().join(VIEWS);
        let empty = snapshot(dir.path());

        fs::write(views.join("a.json"), "1").unwrap();

        let one = snapshot(dir.path());

        assert!(snapshot_changed(&empty, &one));
        assert!(!snapshot_changed(&one, &snapshot(dir.path())));

        fs::write(views.join("a.json"), "12").unwrap();

        let longer = snapshot(dir.path());

        assert!(snapshot_changed(&one, &longer));

        fs::remove_file(views.join("a.json")).unwrap();

        assert!(snapshot_changed(&longer, &snapshot(dir.path())));
    }

    #[test]
    fn author_is_git_stdout_trimmed_or_me_when_empty() {
        assert_eq!(author_from("Ken McLennan\n"), "Ken McLennan");
        assert_eq!(author_from(""), "Me");
        assert_eq!(author_from("  \n"), "Me");
        assert_eq!(author_from(&"x".repeat(80)).len(), 64);
    }

    #[test]
    fn rename_output_is_parsed_per_file() {
        let output = "R100\0old/a.py\0new/a.py\0R087\0b.py\0c.py\0";

        assert_eq!(
            parse_renames(output),
            vec![
                Rename {
                    from: "old/a.py".to_string(),
                    to: "new/a.py".to_string()
                },
                Rename {
                    from: "b.py".to_string(),
                    to: "c.py".to_string()
                },
            ]
        );
        assert!(parse_renames("").is_empty());
    }

    #[test]
    fn renames_since_refuses_option_shaped_and_malformed_commits() {
        let dir = repo();

        assert!(renames_since(dir.path(), "--output=x").is_empty());
        assert!(renames_since(dir.path(), "ABCDEF1").is_empty());
        assert!(renames_since(dir.path(), "abc").is_empty());
        assert!(!dir.path().join("x").exists());
    }

    fn git(dir: &Path, args: &[&str]) -> bool {
        Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(["-c", "user.name=t", "-c", "user.email=t@t"])
            .args(args)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
    }

    fn head(dir: &Path) -> String {
        let output = Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(["rev-parse", "HEAD"])
            .output()
            .unwrap();

        String::from_utf8_lossy(&output.stdout).trim().to_string()
    }

    fn stub_scanner(dir: &Path) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;

        let script = dir.join("stub-recognizer");

        fs::write(
            &script,
            "#!/bin/sh\nmkdir -p \"$2/.recognizer/cache\"\nprintf '{' > \"$2/.recognizer/cache/scan.stub.json\"\nfor f in \"$2\"/pkg/*.py; do printf '\"id\":1,' >> \"$2/.recognizer/cache/scan.stub.json\"; done\nprintf '}' >> \"$2/.recognizer/cache/scan.stub.json\"\n",
        )
        .unwrap();
        fs::set_permissions(&script, fs::Permissions::from_mode(0o755)).unwrap();

        script
    }

    #[test]
    fn scans_at_reads_the_modules_of_each_commit() {
        let dir = TempDir::new().unwrap();
        let root = dir.path().join("repo");
        let root = root.as_path();

        fs::create_dir_all(root).unwrap();

        assert!(git(root, &["init", "-q"]));
        fs::create_dir_all(root.join("pkg")).unwrap();
        fs::write(root.join("pkg/__init__.py"), "").unwrap();
        fs::write(root.join("pkg/one.py"), "X = 1\n").unwrap();
        assert!(git(root, &["add", "."]));
        assert!(git(root, &["commit", "-q", "-m", "one"]));

        let first = head(root);

        fs::write(root.join("pkg/two.py"), "from pkg import one\n").unwrap();
        assert!(git(root, &["add", "."]));
        assert!(git(root, &["commit", "-q", "-m", "two"]));

        let second = head(root);
        let command = stub_scanner(dir.path()).display().to_string();
        let tools = TempDir::new().unwrap();
        let runner = working_runner(tools.path());
        let temp = TempDir::new().unwrap();
        let modules = |commit: &str| -> Option<usize> {
            scans_in(temp.path(), root, commit, &runner, &command).map(|scans| {
                scans
                    .iter()
                    .map(|scan| scan.text.matches("\"id\"").count())
                    .sum()
            })
        };

        assert_eq!(modules(&first), Some(2));
        assert_eq!(modules(&second), Some(3));
        assert!(scans_in(temp.path(), root, "--output=x", &runner, &command).is_none());
        assert!(scans_in(temp.path(), root, "deadbeefdeadbeef", &runner, &command).is_none());
        assert_eq!(fs::read_dir(temp.path()).unwrap().count(), 0);
    }

    fn history(dir: &Path, commits: usize) -> (PathBuf, Vec<String>) {
        let root = dir.join("history");

        fs::create_dir_all(root.join("pkg")).unwrap();
        assert!(git(&root, &["init", "-q"]));

        let mut found = Vec::new();

        for n in 0..commits {
            fs::write(root.join(format!("pkg/m{n}.py")), "X = 1\n").unwrap();
            assert!(git(&root, &["add", "."]));
            assert!(git(&root, &["commit", "-q", "-m", &format!("c{n}")]));
            found.push(head(&root));
        }

        (root, found)
    }

    fn logging_scanner(dir: &Path, log: &Path, exit: i32) -> String {
        script(
            dir,
            "logging-recognizer",
            &format!(
                "echo start >> '{log}'\nsleep 0.2\nmkdir -p \"$2/.recognizer/cache\"\nprintf '{{\"id\":1}}' > \"$2/.recognizer/cache/scan.stub.json\"\necho end >> '{log}'\nexit {exit}",
                log = log.display()
            ),
        )
        .display()
        .to_string()
    }

    fn peak_overlap(log: &Path) -> (usize, usize) {
        let text = fs::read_to_string(log).unwrap();
        let (mut active, mut peak, mut starts) = (0usize, 0usize, 0usize);

        for line in text.lines() {
            if line == "start" {
                active += 1;
                starts += 1;
                peak = peak.max(active);
            } else {
                active -= 1;
            }
        }

        (peak, starts)
    }

    #[test]
    fn many_scans_at_once_never_run_more_than_the_bound() {
        let dir = TempDir::new().unwrap();
        let (root, commits) = history(dir.path(), 24);
        let log = dir.path().join("log");
        let command = logging_scanner(dir.path(), &log, 0);
        let tools = TempDir::new().unwrap();
        let shell = shell_running_the_script(tools.path(), &tools.path().join("count"));
        let runner = runner_with(&shell, Duration::from_secs(10), Duration::from_secs(30), 3);
        let temp = TempDir::new().unwrap();

        let found: Vec<_> = std::thread::scope(|scope| {
            let handles: Vec<_> = commits
                .iter()
                .map(|commit| {
                    let (root, runner, command, temp) = (&root, &runner, &command, temp.path());

                    scope.spawn(move || scans_in(temp, root, commit, runner, command))
                })
                .collect();

            handles
                .into_iter()
                .map(|handle| handle.join().unwrap())
                .collect()
        });

        let (peak, starts) = peak_overlap(&log);

        assert!(found.iter().all(Option::is_some));
        assert_eq!(starts, 24);
        assert!(peak <= 3, "peak {peak}");
        assert_eq!(fs::read_dir(temp.path()).unwrap().count(), 0);
    }

    #[test]
    fn identical_comparisons_run_once_and_a_repeat_inside_the_window_runs_none() {
        let dir = TempDir::new().unwrap();
        let (root, commits) = history(dir.path(), 1);
        let log = dir.path().join("log");
        let command = logging_scanner(dir.path(), &log, 0);
        let tools = TempDir::new().unwrap();
        let runner = working_runner(tools.path());
        let temp = TempDir::new().unwrap();
        let comparisons = Comparisons::default();

        let found: Vec<_> = std::thread::scope(|scope| {
            let handles: Vec<_> = (0..10)
                .map(|_| {
                    scope.spawn(|| {
                        comparisons.scans(temp.path(), &root, &commits[0], &runner, &command)
                    })
                })
                .collect();

            handles
                .into_iter()
                .map(|handle| handle.join().unwrap())
                .collect()
        });

        assert!(found[0].is_some());
        assert!(found.iter().all(|one| one == &found[0]));
        assert_eq!(peak_overlap(&log).1, 1);

        assert_eq!(
            comparisons.scans(temp.path(), &root, &commits[0], &runner, &command),
            found[0]
        );
        assert_eq!(peak_overlap(&log).1, 1);
    }

    #[test]
    fn the_temp_directory_is_removed_when_the_scan_fails() {
        let dir = TempDir::new().unwrap();
        let (root, commits) = history(dir.path(), 1);
        let log = dir.path().join("log");
        let command = logging_scanner(dir.path(), &log, 2);
        let tools = TempDir::new().unwrap();
        let runner = working_runner(tools.path());
        let temp = TempDir::new().unwrap();

        assert!(scans_in(temp.path(), &root, &commits[0], &runner, &command).is_none());
        assert_eq!(peak_overlap(&log).1, 1);
        assert_eq!(fs::read_dir(temp.path()).unwrap().count(), 0);
    }

    #[test]
    fn the_temp_directory_is_removed_when_the_scan_panics() {
        let temp = TempDir::new().unwrap();

        let panicked = std::panic::catch_unwind(|| {
            let held = TempScan::create(temp.path()).unwrap();

            assert!(held.0.exists());
            panic!("scan blew up");
        });

        assert!(panicked.is_err());
        assert_eq!(fs::read_dir(temp.path()).unwrap().count(), 0);
    }

    #[test]
    fn the_startup_sweep_removes_only_old_recognizer_at_directories() {
        let temp = TempDir::new().unwrap();
        let old = std::time::SystemTime::now() - Duration::from_secs(7200);

        for name in ["recognizer-at-1-1", "recognizer-at-2-2", "other-dir"] {
            fs::create_dir(temp.path().join(name)).unwrap();
        }

        for name in ["recognizer-at-1-1", "other-dir"] {
            fs::File::open(temp.path().join(name))
                .unwrap()
                .set_modified(old)
                .unwrap();
        }

        sweep_stale(temp.path(), Duration::from_secs(3600));

        assert!(!temp.path().join("recognizer-at-1-1").exists());
        assert!(temp.path().join("recognizer-at-2-2").exists());
        assert!(temp.path().join("other-dir").exists());
    }

    fn run_git(dir: &Path, args: &[&str]) {
        let status = Command::new("git")
            .arg("-C")
            .arg(dir)
            .args([
                "-c",
                "user.name=t",
                "-c",
                "user.email=t@t",
                "-c",
                "commit.gpgsign=false",
            ])
            .args(args)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .unwrap();

        assert!(status.success(), "git {args:?}");
    }

    fn commit_file(dir: &Path, file: &str, text: &str) {
        fs::write(dir.join(file), text).unwrap();
        run_git(dir, &["add", file]);
        run_git(dir, &["commit", "-m", file]);
    }

    fn git_repo() -> TempDir {
        let dir = TempDir::new().unwrap();

        run_git(dir.path(), &["init", "-q", "-b", "main"]);
        commit_file(dir.path(), "a.py", "1");

        dir
    }

    #[test]
    fn refs_agree_with_the_shared_fixture() {
        let text = fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../fixtures/views/refs.json"
        ))
        .unwrap();
        let fixture: serde_json::Value = serde_json::from_str(&text).unwrap();

        for key in ["accept", "reject"] {
            for entry in fixture[key].as_array().unwrap() {
                let reference = entry.as_str().unwrap();

                assert_eq!(valid_ref(reference), key == "accept", "{reference:?}");
            }
        }
    }

    #[test]
    fn name_status_parses_known_letters_only() {
        assert_eq!(
            parse_name_status("D\0src/b.py\0A\0src/c.py\0U\0x\0"),
            vec![
                FileChange {
                    status: "D".into(),
                    path: "src/b.py".into()
                },
                FileChange {
                    status: "A".into(),
                    path: "src/c.py".into()
                },
            ]
        );
        assert!(parse_name_status("").is_empty());
    }

    #[test]
    fn a_diverged_branch_is_live_with_its_changes() {
        let dir = git_repo();

        run_git(dir.path(), &["checkout", "-q", "-b", "feat"]);
        commit_file(dir.path(), "b.py", "2");
        run_git(dir.path(), &["checkout", "-q", "main"]);
        commit_file(dir.path(), "c.py", "3");

        let range = change_range(dir.path(), "main", "feat").unwrap();

        assert!(!range.merged);
        assert!(range.base_commit.is_some() && range.head_commit.is_some());
        assert_eq!(
            range.changes,
            vec![FileChange {
                status: "A".into(),
                path: "b.py".into()
            }]
        );
    }

    #[test]
    fn a_head_behind_the_base_is_merged() {
        let dir = git_repo();

        run_git(dir.path(), &["branch", "feat"]);
        commit_file(dir.path(), "b.py", "2");

        assert!(change_range(dir.path(), "main", "feat").unwrap().merged);
    }

    #[test]
    fn equal_commits_are_not_merged_and_have_no_changes() {
        let dir = git_repo();

        run_git(dir.path(), &["branch", "feat"]);

        let range = change_range(dir.path(), "main", "feat").unwrap();

        assert!(!range.merged);
        assert!(range.changes.is_empty());
    }

    #[test]
    fn an_unknown_head_or_base_has_no_commit_and_no_changes() {
        let dir = git_repo();
        let head = change_range(dir.path(), "main", "ghost").unwrap();
        let base = change_range(dir.path(), "ghost", "main").unwrap();

        assert!(head.head_commit.is_none() && head.base_commit.is_some());
        assert!(base.base_commit.is_none() && base.head_commit.is_some());
        assert!(!head.merged && head.changes.is_empty());
    }

    #[test]
    fn option_shaped_refs_are_refused_before_git_runs() {
        let dir = TempDir::new().unwrap();

        assert!(change_range(dir.path(), "--output=x", "main").is_none());
        assert!(change_range(dir.path(), "main", "-x").is_none());
        assert!(!dir.path().join("x").exists());
    }

    #[test]
    fn a_folder_outside_git_returns_nothing() {
        let dir = TempDir::new().unwrap();

        assert!(change_range(dir.path(), "main", "feat").is_none());
    }

    #[test]
    fn remove_view_deletes_the_file_and_refuses_the_rest() {
        let dir = repo();

        write_view(dir.path(), "a", "{}").unwrap();
        remove_view(dir.path(), "a").unwrap();

        assert!(!view_file(dir.path(), "a").exists());
        assert!(remove_view(dir.path(), "a").is_err());
        assert!(remove_view(dir.path(), "../a").is_err());

        #[cfg(unix)]
        {
            let target = dir.path().join("target.json");

            fs::write(&target, "{}").unwrap();
            std::os::unix::fs::symlink(&target, view_file(dir.path(), "link")).unwrap();

            assert!(remove_view(dir.path(), "link").is_err());
            assert!(target.exists());
        }
    }
}
