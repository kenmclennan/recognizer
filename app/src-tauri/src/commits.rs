use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, SystemTime};

use serde::Serialize;

use crate::tool_runner::{runner, ToolRunner};
use crate::views::{parse_name_status, valid_ref, FileChange};

const HISTORY_LIMIT: &str = "200";
const BRANCH_LIMIT: usize = 100;
const REF_LIMIT: usize = 100;
const CHANGES_LIMIT: usize = 2000;
const PULL_REQUEST_LIMIT: &str = "50";
const GH_TIMEOUT: Duration = Duration::from_secs(20);
const HISTORY_FORMAT: &str = "--format=%x1e%H%x1f%h%x1f%P%x1f%an%x1f%ct%x1f%s%x1f%D";
const BRANCH_FORMAT: &str =
    "--format=%(refname:short)%1f%(objectname:short)%1f%(authorname)%1f%(committerdate:unix)";
const PULL_REQUEST_FIELDS: &str =
    "number,title,headRefName,headRefOid,author,updatedAt,isDraft,statusCheckRollup";

#[derive(Debug, PartialEq, Serialize)]
pub struct History {
    pub branch: Option<String>,
    pub text: String,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Branches {
    pub default_ref: Option<String>,
    pub total: usize,
    pub text: String,
}

#[derive(Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RefFacts {
    #[serde(rename = "ref")]
    pub reference: String,
    pub merge_base: Option<String>,
    pub behind: Option<u32>,
    pub ahead: Option<u32>,
    pub changes: Option<Vec<FileChange>>,
}

#[derive(Debug, PartialEq, Serialize)]
pub struct PullRequests {
    pub status: String,
    pub detail: String,
    pub text: String,
}

fn git(folder: &Path, args: &[&str]) -> Result<(bool, String, String), String> {
    runner().limited(|| {
        Command::new("git")
            .arg("-C")
            .arg(folder)
            .args(args)
            .stdin(Stdio::null())
            .output()
            .map(|output| {
                (
                    output.status.success(),
                    String::from_utf8_lossy(&output.stdout).into_owned(),
                    String::from_utf8_lossy(&output.stderr).into_owned(),
                )
            })
            .map_err(|error| error.to_string())
    })
}

fn git_stdout(folder: &Path, args: &[&str]) -> Option<String> {
    git(folder, args)
        .ok()
        .filter(|(ok, _, _)| *ok)
        .map(|(_, stdout, _)| stdout.trim().to_string())
        .filter(|text| !text.is_empty())
}

fn first_line(text: &str) -> String {
    text.lines().next().unwrap_or("").trim().to_string()
}

pub fn list_history(folder: &Path) -> Result<History, String> {
    let (ok, text, error) = git(
        folder,
        &[
            "-c",
            "core.quotePath=false",
            "log",
            "-n",
            HISTORY_LIMIT,
            "--no-renames",
            "--diff-merges=first-parent",
            "--name-status",
            HISTORY_FORMAT,
            "HEAD",
        ],
    )?;

    if !ok {
        return Err(first_line(&error));
    }

    Ok(History {
        branch: git_stdout(folder, &["symbolic-ref", "--short", "-q", "HEAD"]),
        text,
    })
}

pub fn default_ref(folder: &Path) -> Option<String> {
    git_stdout(
        folder,
        &["symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
    )
    .filter(|name| valid_ref(name))
}

pub fn list_branches(folder: &Path) -> Result<Branches, String> {
    let count = format!("--count={BRANCH_LIMIT}");
    let (ok, text, error) = git(
        folder,
        &[
            "for-each-ref",
            "--sort=-committerdate",
            &count,
            BRANCH_FORMAT,
            "refs/heads",
        ],
    )?;

    if !ok {
        return Err(first_line(&error));
    }

    let total = git(
        folder,
        &["for-each-ref", "--format=%(refname)", "refs/heads"],
    )
    .ok()
    .filter(|(ok, _, _)| *ok)
    .map_or(0, |(_, listing, _)| listing.lines().count())
    .max(text.lines().count());

    Ok(Branches {
        default_ref: default_ref(folder),
        total,
        text,
    })
}

fn resolved_commit(folder: &Path, reference: &str) -> Option<String> {
    git_stdout(
        folder,
        &[
            "rev-parse",
            "--verify",
            "-q",
            &format!("{reference}^{{commit}}"),
        ],
    )
}

fn facts_for(folder: &Path, default: &str, reference: &str, limit: usize) -> RefFacts {
    let mut facts = RefFacts {
        reference: reference.to_string(),
        ..RefFacts::default()
    };

    if !valid_ref(reference) || resolved_commit(folder, reference).is_none() {
        return facts;
    }

    facts.merge_base = git_stdout(folder, &["merge-base", default, reference])
        .filter(|sha| sha.chars().all(|c| c.is_ascii_hexdigit()));

    if let Some(counts) = git_stdout(
        folder,
        &[
            "rev-list",
            "--left-right",
            "--count",
            &format!("{default}...{reference}"),
        ],
    ) {
        let mut parts = counts
            .split_whitespace()
            .map(|part| part.parse::<u32>().ok());

        facts.behind = parts.next().flatten();
        facts.ahead = parts.next().flatten();
    }

    if let Ok((true, diff, _)) = git(
        folder,
        &[
            "diff",
            "--no-renames",
            "--name-status",
            "-z",
            &format!("{default}...{reference}"),
        ],
    ) {
        let changes = parse_name_status(&diff);

        facts.changes = (changes.len() <= limit).then_some(changes);
    }

    facts
}

pub fn ref_facts(folder: &Path, refs: &[String]) -> Vec<RefFacts> {
    let default = default_ref(folder);

    refs.iter()
        .take(REF_LIMIT)
        .map(|reference| match &default {
            Some(default) => facts_for(folder, default, reference, CHANGES_LIMIT),
            None => RefFacts {
                reference: reference.clone(),
                ..RefFacts::default()
            },
        })
        .collect()
}

pub fn read_pull_requests(runner: &ToolRunner, folder: &Path) -> PullRequests {
    let outcome = |status: &str, detail: String, text: String| PullRequests {
        status: status.to_string(),
        detail,
        text,
    };
    let captured = match runner.run_external(
        "gh",
        &[
            "pr",
            "list",
            "--state",
            "open",
            "--limit",
            PULL_REQUEST_LIMIT,
            "--json",
            PULL_REQUEST_FIELDS,
        ],
        folder,
        GH_TIMEOUT,
    ) {
        Ok(captured) => captured,
        Err(_) => return outcome("missing", String::new(), String::new()),
    };

    match captured.code {
        Some(0) => outcome("ok", String::new(), captured.stdout),
        Some(4) if captured.stderr.contains("gh auth login") => {
            outcome("signed-out", first_line(&captured.stderr), String::new())
        }
        _ => {
            let detail = first_line(&captured.stderr);

            outcome(
                "failed",
                if detail.is_empty() {
                    "gh pr list failed".to_string()
                } else {
                    detail
                },
                String::new(),
            )
        }
    }
}

const SETTLE_LIMIT: usize = 8;

#[derive(Debug, Default, PartialEq)]
pub struct GitState {
    head: Option<String>,
    fetch_head: Option<(u64, Option<SystemTime>)>,
    packed_refs: Option<(u64, Option<SystemTime>)>,
    refs: Vec<(String, u64, Option<SystemTime>)>,
}

fn file_stamp(path: &Path) -> Option<(u64, Option<SystemTime>)> {
    std::fs::metadata(path)
        .ok()
        .map(|meta| (meta.len(), meta.modified().ok()))
}

fn collect_refs(dir: &Path, found: &mut Vec<(String, u64, Option<SystemTime>)>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();

        match entry.file_type() {
            Ok(kind) if kind.is_dir() => collect_refs(&path, found),
            Ok(_) => {
                if let Some((len, modified)) = file_stamp(&path) {
                    found.push((path.to_string_lossy().into_owned(), len, modified));
                }
            }
            Err(_) => {}
        }
    }
}

pub fn git_state_snapshot(folder: &Path) -> GitState {
    let Some(paths) = git_stdout(
        folder,
        &[
            "rev-parse",
            "--path-format=absolute",
            "--git-path",
            "HEAD",
            "--git-path",
            "FETCH_HEAD",
            "--git-path",
            "packed-refs",
            "--git-path",
            "refs",
        ],
    ) else {
        return GitState::default();
    };

    let lines: Vec<&str> = paths.lines().collect();

    let [head, fetch_head, packed_refs, refs] = lines.as_slice() else {
        return GitState::default();
    };

    let mut found = Vec::new();

    collect_refs(Path::new(refs), &mut found);
    found.sort_by(|a, b| a.0.cmp(&b.0));

    GitState {
        head: std::fs::read_to_string(head).ok(),
        fetch_head: file_stamp(Path::new(fetch_head)),
        packed_refs: file_stamp(Path::new(packed_refs)),
        refs: found,
    }
}

pub fn snapshot_changed(previous: &GitState, next: &GitState) -> bool {
    previous != next
}

pub struct Settle<T> {
    baseline: T,
    previous: Option<T>,
    waited: usize,
}

impl<T: PartialEq> Settle<T> {
    pub fn new(baseline: T) -> Self {
        Settle {
            baseline,
            previous: None,
            waited: 0,
        }
    }

    pub fn poll(&mut self, next: T) -> bool {
        match self.previous.take() {
            None => {
                if next != self.baseline {
                    self.previous = Some(next);
                    self.waited = 0;
                }

                false
            }
            Some(previous) => {
                self.waited += 1;

                if next == previous || self.waited >= SETTLE_LIMIT {
                    self.baseline = next;
                    self.waited = 0;

                    true
                } else {
                    self.previous = Some(next);

                    false
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tool_runner::tests::{runner_with, script, shell_with_path};
    use crate::tool_runner::{ToolRunner, Toolchain};
    use std::fs;
    use std::path::PathBuf;
    use tempfile::TempDir;

    fn run_git(dir: &Path, args: &[&str]) {
        let status = Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(["-c", "user.name=T", "-c", "user.email=t@example.com"])
            .args(args)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .unwrap();

        assert!(status.success(), "git {args:?} failed");
    }

    fn commit_file(dir: &Path, file: &str, text: &str) {
        fs::write(dir.join(file), text).unwrap();
        run_git(dir, &["add", file]);
        run_git(dir, &["commit", "-q", "-m", file]);
    }

    fn repository() -> TempDir {
        let dir = TempDir::new().unwrap();

        run_git(dir.path(), &["init", "-q", "-b", "main"]);
        commit_file(dir.path(), "a.py", "1");
        commit_file(dir.path(), "b.py", "1");

        dir
    }

    fn with_origin_head(dir: &Path) {
        let head = git_stdout(dir, &["rev-parse", "main"]).unwrap();

        run_git(dir, &["update-ref", "refs/remotes/origin/main", &head]);
        run_git(
            dir,
            &[
                "symbolic-ref",
                "refs/remotes/origin/HEAD",
                "refs/remotes/origin/main",
            ],
        );
    }

    fn branched() -> TempDir {
        let dir = repository();

        with_origin_head(dir.path());
        run_git(dir.path(), &["checkout", "-q", "-b", "feature"]);
        commit_file(dir.path(), "c.py", "1");
        fs::write(dir.path().join("a.py"), "2").unwrap();
        run_git(dir.path(), &["add", "a.py"]);
        run_git(dir.path(), &["commit", "-q", "-m", "edit a"]);
        run_git(dir.path(), &["checkout", "-q", "main"]);
        commit_file(dir.path(), "d.py", "1");
        run_git(
            dir.path(),
            &["update-ref", "refs/remotes/origin/main", "main"],
        );
        run_git(dir.path(), &["tag", "v0.1.0", "main"]);

        dir
    }

    #[test]
    fn list_history_returns_one_record_per_commit_with_the_checked_out_branch() {
        let dir = branched();
        let history = list_history(dir.path()).unwrap();

        assert_eq!(history.branch.as_deref(), Some("main"));
        assert_eq!(history.text.matches('\u{1e}').count(), 3);
        assert!(history.text.contains("v0.1.0"));
        assert!(history.text.contains("d.py"));
    }

    #[test]
    fn list_history_counts_a_merge_commit_against_its_first_parent() {
        let dir = branched();

        run_git(
            dir.path(),
            &["merge", "-q", "--no-ff", "-m", "merge feature", "feature"],
        );

        let history = list_history(dir.path()).unwrap();
        let merge = history.text.split('\u{1e}').nth(1).unwrap();

        assert!(merge.contains("merge feature"));
        assert!(merge.contains("A\tc.py"));
        assert!(merge.contains("M\ta.py"));
    }

    #[test]
    fn list_history_reports_a_detached_head_with_no_branch() {
        let dir = branched();

        run_git(dir.path(), &["checkout", "-q", "--detach", "HEAD"]);

        assert_eq!(list_history(dir.path()).unwrap().branch, None);
    }

    #[test]
    fn list_history_of_a_folder_outside_git_is_an_error() {
        let dir = TempDir::new().unwrap();

        assert!(list_history(dir.path()).is_err());
        assert!(list_branches(dir.path()).is_err());
    }

    #[test]
    fn list_branches_names_the_default_ref_when_origin_head_is_set() {
        let dir = branched();
        let branches = list_branches(dir.path()).unwrap();

        assert_eq!(branches.default_ref.as_deref(), Some("origin/main"));
        assert_eq!(branches.total, 2);
        assert!(branches.text.contains("feature\u{1f}"));
        assert!(branches.text.contains("main\u{1f}"));
    }

    #[test]
    fn list_branches_has_no_default_ref_without_origin_head() {
        let dir = repository();
        let branches = list_branches(dir.path()).unwrap();

        assert_eq!(branches.default_ref, None);
        assert_eq!(branches.total, 1);
    }

    #[test]
    fn ref_facts_returns_ahead_behind_and_the_changed_files_against_the_default_ref() {
        let dir = branched();
        let base = git_stdout(dir.path(), &["merge-base", "main", "feature"]).unwrap();
        let facts = ref_facts(dir.path(), &["feature".to_string()]);

        assert_eq!(
            facts,
            vec![RefFacts {
                reference: "feature".to_string(),
                merge_base: Some(base),
                behind: Some(1),
                ahead: Some(2),
                changes: Some(vec![
                    FileChange {
                        status: "M".to_string(),
                        path: "a.py".to_string(),
                    },
                    FileChange {
                        status: "A".to_string(),
                        path: "c.py".to_string(),
                    },
                ]),
            }]
        );
    }

    #[test]
    fn ref_facts_has_no_changes_for_a_ref_past_the_changes_limit() {
        let dir = branched();
        let base = git_stdout(dir.path(), &["merge-base", "main", "feature"]).unwrap();
        let within = facts_for(dir.path(), "main", "feature", 2);
        let past = facts_for(dir.path(), "main", "feature", 1);

        assert_eq!(within.changes.map(|c| c.len()), Some(2));
        assert_eq!(past.changes, None);
        assert_eq!(past.ahead, Some(2));
        assert_eq!(past.merge_base, Some(base));
    }

    #[test]
    fn list_history_returns_a_non_ascii_file_name_unescaped() {
        let dir = repository();

        commit_file(dir.path(), "é.py", "1");

        let history = list_history(dir.path()).unwrap();

        assert!(history.text.contains("A\té.py"));
        assert!(!history.text.contains("\\303"));
    }

    #[test]
    fn ref_facts_leaves_an_unresolved_ref_all_null_beside_resolved_ones() {
        let dir = branched();
        let sha = git_stdout(dir.path(), &["rev-parse", "feature"]).unwrap();
        let facts = ref_facts(
            dir.path(),
            &["feature".to_string(), "nope".to_string(), sha.clone()],
        );

        assert_eq!(facts.len(), 3);
        assert_eq!(facts[0].ahead, Some(2));
        assert!(facts[0].changes.is_some());
        assert_eq!(facts[1].changes, None);
        assert_eq!(facts[1].ahead, None);
        assert_eq!(
            facts[1],
            RefFacts {
                reference: "nope".to_string(),
                ..RefFacts::default()
            }
        );
        assert_eq!(facts[2].reference, sha);
        assert_eq!(facts[2].ahead, Some(2));
    }

    #[test]
    fn ref_facts_are_all_null_without_a_default_ref() {
        let dir = repository();
        let facts = ref_facts(dir.path(), &["main".to_string()]);

        assert_eq!(
            facts,
            vec![RefFacts {
                reference: "main".to_string(),
                ..RefFacts::default()
            }]
        );
    }

    #[test]
    fn ref_facts_refuse_option_shaped_refs_before_git_runs() {
        let dir = branched();
        let out = dir.path().join("f");
        let facts = ref_facts(
            dir.path(),
            &[format!("--output={}", out.display()), "-x".to_string()],
        );

        assert!(facts.iter().all(|fact| fact.ahead.is_none()));
        assert!(!out.exists());
    }

    #[test]
    fn list_history_runs_over_the_real_committed_history() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
        let shallow = git_stdout(&root, &["rev-parse", "--is-shallow-repository"]);

        if shallow.as_deref() != Some("false") {
            println!("skipped: shallow or no checkout");

            return;
        }

        let history = list_history(&root).unwrap();
        let records: Vec<&str> = history
            .text
            .split('\u{1e}')
            .filter(|record| !record.trim().is_empty())
            .collect();
        let head = git_stdout(&root, &["rev-parse", "HEAD"]).unwrap();

        assert!((1..=200).contains(&records.len()));
        assert_eq!(records[0].split('\u{1f}').next().unwrap(), head);

        for line in records[0].lines().skip(1).filter(|line| !line.is_empty()) {
            let mut parts = line.splitn(2, '\t');
            let status = parts.next().unwrap();
            let path = parts.next().unwrap_or("");

            assert!(["A", "M", "D", "T"].contains(&status), "{line}");
            assert!(!path.is_empty(), "{line}");
        }
    }

    fn gh_runner(dir: &Path, path: &str) -> ToolRunner {
        let shell = shell_with_path(dir, path);

        runner_with(&shell, Duration::from_secs(10), Duration::from_secs(30), 4)
    }

    #[test]
    fn read_pull_requests_returns_gh_json_when_gh_succeeds() {
        let dir = TempDir::new().unwrap();
        let bin = TempDir::new().unwrap();

        script(bin.path(), "gh", "echo '[{\"number\":1}]'");

        let runner = gh_runner(dir.path(), &bin.path().display().to_string());
        let result = read_pull_requests(&runner, dir.path());

        assert_eq!(result.status, "ok");
        assert!(result.text.contains("\"number\":1"));
    }

    #[test]
    fn read_pull_requests_says_missing_when_gh_is_not_on_the_path() {
        let dir = TempDir::new().unwrap();
        let bin = TempDir::new().unwrap();
        let runner = gh_runner(dir.path(), &bin.path().display().to_string());

        assert_eq!(read_pull_requests(&runner, dir.path()).status, "missing");
    }

    #[test]
    fn read_pull_requests_says_signed_out_for_exit_four_naming_gh_auth_login() {
        let dir = TempDir::new().unwrap();
        let bin = TempDir::new().unwrap();

        script(
            bin.path(),
            "gh",
            "echo 'To get started with GitHub CLI, please run:  gh auth login' >&2\nexit 4",
        );

        let runner = gh_runner(dir.path(), &bin.path().display().to_string());

        assert_eq!(read_pull_requests(&runner, dir.path()).status, "signed-out");
    }

    #[test]
    fn read_pull_requests_says_failed_with_the_first_stderr_line() {
        let dir = TempDir::new().unwrap();
        let bin = TempDir::new().unwrap();

        script(bin.path(), "gh", "echo 'boom' >&2\necho 'more' >&2\nexit 1");

        let runner = gh_runner(dir.path(), &bin.path().display().to_string());
        let result = read_pull_requests(&runner, dir.path());

        assert_eq!(result.status, "failed");
        assert_eq!(result.detail, "boom");
    }

    #[test]
    fn external_command_runs_where_command_fails_for_a_bundled_toolchain_without_gh() {
        let dir = TempDir::new().unwrap();
        let bin = TempDir::new().unwrap();
        let commands = TempDir::new().unwrap();

        script(bin.path(), "gh", "echo ok");

        let shell = shell_with_path(dir.path(), &bin.path().display().to_string());
        let runner = ToolRunner::new(
            shell.display().to_string(),
            Duration::from_secs(10),
            Duration::from_secs(30),
            4,
            Toolchain::Bundled {
                folder: commands.path().to_path_buf(),
            },
            "9.9.9",
        );

        assert!(runner.command("gh").is_err());
        assert!(runner.external_command("gh").is_ok());
        assert_eq!(read_pull_requests(&runner, dir.path()).status, "ok");
    }

    fn snapshot_after(dir: &Path, change: impl FnOnce()) -> (GitState, GitState) {
        let before = git_state_snapshot(dir);

        std::thread::sleep(Duration::from_millis(30));
        change();

        (before, git_state_snapshot(dir))
    }

    #[test]
    fn git_state_snapshot_is_equal_across_two_reads_with_nothing_between() {
        let dir = repository();
        let first = git_state_snapshot(dir.path());

        assert!(first.head.is_some());
        assert!(!first.refs.is_empty());
        assert!(!snapshot_changed(&first, &git_state_snapshot(dir.path())));
    }

    #[test]
    fn git_state_snapshot_changes_after_a_commit() {
        let dir = repository();
        let (before, after) = snapshot_after(dir.path(), || commit_file(dir.path(), "c.py", "1"));

        assert!(snapshot_changed(&before, &after));
    }

    #[test]
    fn git_state_snapshot_changes_after_checkout_dash_b() {
        let dir = repository();
        let (before, after) = snapshot_after(dir.path(), || {
            run_git(dir.path(), &["checkout", "-q", "-b", "topic"])
        });

        assert!(snapshot_changed(&before, &after));
    }

    #[test]
    fn git_state_snapshot_changes_after_a_fetch_from_a_local_bare_remote() {
        let dir = repository();
        let remote = TempDir::new().unwrap();

        run_git(remote.path(), &["init", "-q", "--bare", "-b", "main"]);
        run_git(
            dir.path(),
            &[
                "remote",
                "add",
                "origin",
                &remote.path().display().to_string(),
            ],
        );
        run_git(dir.path(), &["push", "-q", "origin", "main"]);

        let (before, after) = snapshot_after(dir.path(), || {
            run_git(dir.path(), &["fetch", "-q", "origin"])
        });

        assert!(snapshot_changed(&before, &after));
    }

    #[test]
    fn git_state_snapshot_changes_after_pack_refs_removes_the_loose_refs() {
        let dir = repository();
        let (before, after) =
            snapshot_after(dir.path(), || run_git(dir.path(), &["pack-refs", "--all"]));

        assert!(!before.refs.is_empty());
        assert!(snapshot_changed(&before, &after));
    }

    #[test]
    fn git_state_snapshot_is_empty_for_a_folder_outside_git() {
        let dir = TempDir::new().unwrap();

        assert_eq!(git_state_snapshot(dir.path()), GitState::default());
    }

    #[test]
    fn git_state_snapshot_of_a_worktree_changes_after_a_commit_inside_it() {
        let dir = repository();
        let parent = TempDir::new().unwrap();
        let tree = parent.path().join("tree");

        run_git(
            dir.path(),
            &[
                "worktree",
                "add",
                "-q",
                "-b",
                "wt",
                &tree.display().to_string(),
            ],
        );

        let (before, after) = snapshot_after(&tree, || commit_file(&tree, "w.py", "1"));

        assert!(before.head.is_some());
        assert!(snapshot_changed(&before, &after));
    }

    #[test]
    fn git_state_snapshot_of_a_worktree_changes_after_a_checkout_inside_it() {
        let dir = repository();
        let parent = TempDir::new().unwrap();
        let tree = parent.path().join("tree");

        run_git(
            dir.path(),
            &[
                "worktree",
                "add",
                "-q",
                "-b",
                "wt",
                &tree.display().to_string(),
            ],
        );

        let (before, after) =
            snapshot_after(&tree, || run_git(&tree, &["checkout", "-q", "-b", "other"]));

        assert_ne!(before.head, after.head);
        assert!(snapshot_changed(&before, &after));
    }

    #[test]
    fn git_state_snapshot_runs_over_the_real_repository() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
        let first = git_state_snapshot(&root);

        assert_ne!(first, GitState::default());
        assert!(!snapshot_changed(&first, &git_state_snapshot(&root)));
    }

    #[test]
    fn snapshot_changed_is_false_for_equal_snapshots_and_true_otherwise() {
        assert!(!snapshot_changed(
            &GitState::default(),
            &GitState::default()
        ));
        assert!(snapshot_changed(
            &GitState::default(),
            &GitState {
                head: Some("x".to_string()),
                ..GitState::default()
            }
        ));
    }

    fn settle(last: char, polls: &[char]) -> Option<usize> {
        let mut state = Settle::new(last);

        polls.iter().position(|next| state.poll(*next))
    }

    #[test]
    fn settle_emits_nothing_while_the_snapshot_is_unchanged() {
        assert_eq!(settle('a', &['a', 'a', 'a']), None);
    }

    #[test]
    fn settle_emits_at_the_poll_that_sees_the_change_unchanged() {
        assert_eq!(settle('a', &['b', 'b']), Some(1));
    }

    #[test]
    fn settle_emits_on_the_bound_when_every_poll_changes() {
        let polls: Vec<char> = "bcdefghijklmnop".chars().collect();

        assert_eq!(settle('a', &polls), Some(8));
    }

    #[test]
    fn settle_does_not_emit_one_poll_before_the_bound() {
        let polls: Vec<char> = "bcdefghi".chars().collect();

        assert_eq!(settle('a', &polls), None);
    }

    #[test]
    fn settle_emits_again_for_a_second_change() {
        let mut state = Settle::new('a');
        let seen: Vec<bool> = ['b', 'b', 'b', 'c', 'c']
            .iter()
            .map(|next| state.poll(*next))
            .collect();

        assert_eq!(seen, [false, true, false, false, true]);
    }
}
