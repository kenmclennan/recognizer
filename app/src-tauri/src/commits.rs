use std::path::Path;
use std::process::{Command, Stdio};
use std::time::Duration;

use serde::Serialize;

use crate::tool_runner::{runner, ToolRunner};
use crate::views::{parse_name_status, valid_ref};

const HISTORY_LIMIT: &str = "200";
const BRANCH_LIMIT: usize = 100;
const REF_LIMIT: usize = 100;
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
    pub added: Option<u32>,
    pub modified: Option<u32>,
    pub removed: Option<u32>,
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

fn facts_for(folder: &Path, default: &str, reference: &str) -> RefFacts {
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
        let count = |status: &str| changes.iter().filter(|c| c.status == status).count() as u32;

        facts.added = Some(count("A"));
        facts.modified = Some(count("M") + count("T"));
        facts.removed = Some(count("D"));
    }

    facts
}

pub fn ref_facts(folder: &Path, refs: &[String]) -> Vec<RefFacts> {
    let default = default_ref(folder);

    refs.iter()
        .take(REF_LIMIT)
        .map(|reference| match &default {
            Some(default) => facts_for(folder, default, reference),
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
    fn ref_facts_counts_ahead_behind_and_changed_files_against_the_default_ref() {
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
                added: Some(1),
                modified: Some(1),
                removed: Some(0),
            }]
        );
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
}
