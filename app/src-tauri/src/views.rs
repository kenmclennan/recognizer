use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::UNIX_EPOCH;

use serde::Serialize;

use crate::fs_safe::{checked_relative, write_atomic};
use crate::repository::{self, ScanFile, ScanReport};

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

pub fn scans_at(
    folder: &Path,
    commit: &str,
    shell: &str,
    config_file: &Path,
) -> Option<Vec<ScanFile>> {
    if !valid_commit(commit) {
        return None;
    }

    let nanos = std::time::SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_nanos())
        .unwrap_or(0);
    let target: PathBuf =
        std::env::temp_dir().join(format!("recognizer-at-{}-{nanos}", std::process::id()));

    fs::create_dir_all(&target).ok()?;

    let scans = if extract_commit(folder, commit, &target) {
        match repository::scan(&target, shell, config_file) {
            ScanReport::Scanned { scans, .. } if !scans.is_empty() => Some(scans),
            _ => None,
        }
    } else {
        None
    };

    let _ = fs::remove_dir_all(&target);

    scans
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
        let config = dir.path().join("config.json");

        fs::write(
            &config,
            format!(
                r#"{{"recognizer_path": "{}"}}"#,
                stub_scanner(dir.path()).display()
            ),
        )
        .unwrap();
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
        let modules = |commit: &str| -> Option<usize> {
            scans_at(root, commit, &shell, &config).map(|scans| {
                scans
                    .iter()
                    .map(|scan| scan.text.matches("\"id\"").count())
                    .sum()
            })
        };

        assert_eq!(modules(&first), Some(2));
        assert_eq!(modules(&second), Some(3));
        assert!(scans_at(root, "--output=x", &shell, &config).is_none());
        assert!(scans_at(root, "deadbeefdeadbeef", &shell, &config).is_none());
    }
}
