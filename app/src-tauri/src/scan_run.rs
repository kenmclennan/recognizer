use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{ChildStdin, Command, Stdio};
use std::sync::Mutex;

use serde::Serialize;

use crate::fs_safe::write_atomic;
use crate::repository::{missing_hint, scan_args, strip_escapes, Describe};
use crate::tool_runner::ToolRunner;

const LOG: &str = ".recognizer/cache/log";
const MODULES_DIR: &str = ".recognizer/cache";

pub fn check_modules(modules: &[String]) -> Result<(), String> {
    if modules.is_empty() {
        return Err("the module scope is empty".to_string());
    }

    if modules.iter().any(|id| id.is_empty()) {
        return Err("a module id in the scope is empty".to_string());
    }

    if modules.iter().any(|id| id.contains('\0')) {
        return Err("a module id in the scope holds a NUL".to_string());
    }

    Ok(())
}

fn modules_file(folder: &Path, label: &str) -> PathBuf {
    let safe: String = label
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
        .collect();

    folder
        .join(MODULES_DIR)
        .join(format!("scan-modules-{safe}.json"))
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(
    tag = "status",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum ScanRun {
    Finished {
        exit_code: i32,
        stderr: String,
        log: Option<String>,
    },
    Stopped,
    CommandMissing {
        hint: String,
    },
    Failed {
        exit_code: i32,
        stderr: String,
    },
    Refused {
        reason: String,
    },
}

#[derive(Default)]
struct Handle {
    pid: Option<u32>,
    stopped: bool,
    stdin: Option<ChildStdin>,
}

#[derive(Default)]
pub struct ScanRuns(Mutex<HashMap<String, Handle>>);

pub fn kill_group(pid: u32) {
    let _ = Command::new("/bin/kill")
        .args(["-TERM", "--"])
        .arg(format!("-{pid}"))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

impl ScanRuns {
    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, Handle>> {
        self.0.lock().unwrap_or_else(|error| error.into_inner())
    }

    pub fn begin(&self, label: &str) -> Result<(), String> {
        let mut runs = self.lock();

        if runs.contains_key(label) {
            return Err("a scan is already running".to_string());
        }

        runs.insert(label.to_string(), Handle::default());

        Ok(())
    }

    fn started(&self, label: &str, pid: u32) {
        let mut runs = self.lock();

        if let Some(handle) = runs.get_mut(label) {
            handle.pid = Some(pid);

            if handle.stopped {
                kill_group(pid);
            }
        }
    }

    fn attach_stdin(&self, label: &str, stdin: ChildStdin) {
        if let Some(handle) = self.lock().get_mut(label) {
            handle.stdin = Some(stdin);
        }
    }

    pub fn answer_describe(&self, label: &str, describe: bool) -> Result<(), String> {
        let mut runs = self.lock();
        let Some(stdin) = runs.get_mut(label).and_then(|handle| handle.stdin.take()) else {
            return Err("no scan is waiting for an answer".to_string());
        };
        let mut stdin = stdin;
        let word = if describe { "describe" } else { "skip" };

        writeln!(stdin, "{word}").map_err(|error| error.to_string())
    }

    pub fn stop(&self, label: &str) {
        let mut runs = self.lock();

        if let Some(handle) = runs.get_mut(label) {
            handle.stopped = true;
            handle.stdin = None;

            if let Some(pid) = handle.pid {
                kill_group(pid);
            }
        }
    }

    fn finish(&self, label: &str) -> bool {
        self.lock()
            .remove(label)
            .is_some_and(|handle| handle.stopped)
    }

    pub fn running(&self, label: &str) -> bool {
        self.lock().contains_key(label)
    }
}

pub fn summary_log(line: &str) -> Option<String> {
    let event: serde_json::Value = serde_json::from_str(line).ok()?;

    if event.get("event")?.as_str()? != "summary" {
        return None;
    }

    let id = event.get("log")?.as_str()?;

    Some(format!("{LOG}/{id}.json"))
}

fn result_for(exit: Option<i32>, stopped: bool, stderr: String, log: Option<String>) -> ScanRun {
    if stopped {
        return ScanRun::Stopped;
    }

    match exit {
        Some(127) => ScanRun::CommandMissing {
            hint: missing_hint(),
        },
        Some(code @ (0 | 1)) => ScanRun::Finished {
            exit_code: code,
            stderr,
            log,
        },
        other => ScanRun::Failed {
            exit_code: other.unwrap_or(-1),
            stderr,
        },
    }
}

#[allow(clippy::too_many_arguments)]
pub fn run_with(
    runs: &ScanRuns,
    label: &str,
    folder: &Path,
    runner: &ToolRunner,
    command: &str,
    describe: Describe,
    measure: &[String],
    sense: &[String],
    modules: Option<&[String]>,
    confirm_above: Option<f64>,
    prepare: impl FnOnce(),
    emit: &(dyn Fn(String) + Sync),
) -> ScanRun {
    if let Some(ids) = modules {
        if let Err(reason) = check_modules(ids) {
            return ScanRun::Refused { reason };
        }
    }

    if let Err(reason) = runs.begin(label) {
        return ScanRun::Refused { reason };
    }

    prepare();

    let file = modules.map(|_| modules_file(folder, label));

    if let (Some(path), Some(ids)) = (&file, modules) {
        let text = match serde_json::to_string(ids) {
            Ok(text) => text,
            Err(error) => {
                runs.finish(label);

                return ScanRun::Refused {
                    reason: error.to_string(),
                };
            }
        };

        if let Err(error) = write_atomic(path, &text) {
            runs.finish(label);

            return ScanRun::Refused {
                reason: format!("{}: {error}", path.display()),
            };
        }
    }

    let result = spawn_and_stream(
        runs,
        label,
        folder,
        runner,
        command,
        describe,
        measure,
        sense,
        file.as_deref(),
        confirm_above,
        emit,
    );

    if let Some(path) = &file {
        let _ = fs::remove_file(path);
    }

    runs.finish(label);

    result
}

#[allow(clippy::too_many_arguments)]
fn spawn_and_stream(
    runs: &ScanRuns,
    label: &str,
    folder: &Path,
    runner: &ToolRunner,
    command: &str,
    describe: Describe,
    measure: &[String],
    sense: &[String],
    modules_file: Option<&Path>,
    confirm_above: Option<f64>,
    emit: &(dyn Fn(String) + Sync),
) -> ScanRun {
    let Some(mut process) = runner.command(command) else {
        return ScanRun::CommandMissing {
            hint: missing_hint(),
        };
    };

    process
        .args(scan_args(folder, describe, measure, sense))
        .args(
            modules_file
                .map(|path| vec!["--modules".to_string(), path.display().to_string()])
                .unwrap_or_default(),
        )
        .args(
            confirm_above
                .filter(|_| describe != Describe::Off)
                .map(|usd| vec!["--confirm-above".to_string(), usd.to_string()])
                .unwrap_or_default(),
        )
        .stdin(if confirm_above.is_some() && describe != Describe::Off {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;

        process.process_group(0);
    }

    let mut child = match process.spawn() {
        Ok(child) => child,
        Err(_) => {
            return ScanRun::CommandMissing {
                hint: missing_hint(),
            }
        }
    };

    if let Some(stdin) = child.stdin.take() {
        runs.attach_stdin(label, stdin);
    }

    runs.started(label, child.id());

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    let mut log = None;

    let (stderr_text, status) = std::thread::scope(|scope| {
        let collected = scope.spawn(move || {
            let mut text = String::new();

            if let Some(mut stderr) = stderr {
                let mut bytes = Vec::new();

                let _ = stderr.read_to_end(&mut bytes);
                text = String::from_utf8_lossy(&bytes).into_owned();
            }

            text
        });

        if let Some(stdout) = stdout {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                let line = strip_escapes(&line);

                if !line.trim().is_empty() {
                    if let Some(found) = summary_log(&line) {
                        log = Some(found);
                    }

                    emit(line);
                }
            }
        }

        let status = child.wait();

        (collected.join().unwrap_or_default(), status)
    });

    let stopped = runs.lock().get(label).is_some_and(|handle| handle.stopped);
    let exit = status.ok().and_then(|status| status.code());

    result_for(exit, stopped, stderr_text, log)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::mpsc;
    use std::sync::Arc;
    use std::time::Duration;
    use tempfile::TempDir;

    use crate::tool_runner::tests::{runner_with, working_runner};

    fn names(list: &[&str]) -> Vec<String> {
        list.iter().map(|name| name.to_string()).collect()
    }

    #[cfg(unix)]
    fn fake_command(dir: &Path, body: &str) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;

        let path = dir.join("fake-recognizer");

        fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();

        path
    }

    fn collect(
        runs: &ScanRuns,
        folder: &Path,
        command: &Path,
        describe: Describe,
        measure: &[String],
        sense: &[String],
    ) -> (ScanRun, Vec<String>) {
        let lines = Mutex::new(Vec::new());
        let tools = TempDir::new().unwrap();
        let runner = working_runner(tools.path());
        let result = run_with(
            runs,
            "w-1",
            folder,
            &runner,
            &command.display().to_string(),
            describe,
            measure,
            sense,
            None,
            None,
            || {},
            &|line| lines.lock().unwrap().push(line),
        );

        (result, lines.into_inner().unwrap())
    }

    #[test]
    fn the_summary_names_the_log_record_or_none() {
        assert_eq!(
            summary_log(r#"{"event":"summary","exit":0,"log":"20261102T123456789Z-scan"}"#),
            Some(format!("{LOG}/20261102T123456789Z-scan.json"))
        );
        assert_eq!(summary_log(r#"{"event":"summary","log":null}"#), None);
        assert_eq!(summary_log(r#"{"event":"summary"}"#), None);
        assert_eq!(
            summary_log(r#"{"event":"entry","log":"20261102T123456789Z-scan"}"#),
            None
        );
        assert_eq!(summary_log("not json"), None);
    }

    #[test]
    fn the_result_serialises_to_the_webview_contract() {
        let json = |run: &ScanRun| serde_json::to_value(run).unwrap();

        assert_eq!(
            json(&ScanRun::Finished {
                exit_code: 1,
                stderr: "e".into(),
                log: Some("l".into())
            }),
            serde_json::json!({"status": "finished", "exitCode": 1, "stderr": "e", "log": "l"})
        );
        assert_eq!(
            json(&ScanRun::Stopped),
            serde_json::json!({"status": "stopped"})
        );
        assert_eq!(
            json(&ScanRun::Refused { reason: "r".into() }),
            serde_json::json!({"status": "refused", "reason": "r"})
        );
        assert_eq!(
            json(&ScanRun::Failed {
                exit_code: 2,
                stderr: "e".into()
            }),
            serde_json::json!({"status": "failed", "exitCode": 2, "stderr": "e"})
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_profile_noise_never_reaches_the_emitted_lines() {
        use std::os::unix::fs::PermissionsExt;

        let dir = TempDir::new().unwrap();
        let command = fake_command(dir.path(), r#"echo '{"event":"entry"}'"#);
        let shell = dir.path().join("fake-shell");

        fs::write(
            &shell,
            "#!/bin/sh\nprintf '\\033]1337;RemoteHost=ken@host\\007shell=zsh\\n'\nshift\nexec /bin/sh -c \"$@\"\n",
        )
        .unwrap();
        fs::set_permissions(&shell, fs::Permissions::from_mode(0o755)).unwrap();

        let runner = runner_with(&shell, Duration::from_secs(10), Duration::from_secs(30), 4);
        let lines = Mutex::new(Vec::new());
        let runs = ScanRuns::default();
        let result = run_with(
            &runs,
            "w-1",
            dir.path(),
            &runner,
            &command.display().to_string(),
            Describe::Off,
            &[],
            &[],
            None,
            None,
            || {},
            &|line| lines.lock().unwrap().push(line),
        );

        assert!(matches!(result, ScanRun::Finished { exit_code: 0, .. }));
        assert_eq!(lines.into_inner().unwrap(), vec![r#"{"event":"entry"}"#]);
    }

    #[cfg(unix)]
    #[test]
    fn lines_are_emitted_in_order_and_exit_one_is_finished() {
        let dir = TempDir::new().unwrap();
        let command = fake_command(
            dir.path(),
            r#"echo '{"event":"phase"}'; echo '{"event":"summary"}'; exit 1"#,
        );
        let (result, lines) = collect(
            &ScanRuns::default(),
            dir.path(),
            &command,
            Describe::Off,
            &[],
            &[],
        );

        assert_eq!(
            lines,
            names(&[r#"{"event":"phase"}"#, r#"{"event":"summary"}"#])
        );
        assert_eq!(
            result,
            ScanRun::Finished {
                exit_code: 1,
                stderr: String::new(),
                log: None
            }
        );
    }

    #[cfg(unix)]
    #[test]
    fn the_flags_reach_the_command_after_the_folder() {
        let dir = TempDir::new().unwrap();
        let command = fake_command(dir.path(), r#"echo "$@""#);
        let (_, lines) = collect(
            &ScanRuns::default(),
            dir.path(),
            &command,
            Describe::Stale,
            &names(&["m"]),
            &names(&["a"]),
        );

        assert_eq!(
            lines,
            vec![format!(
                "scan {} --json --describe --measure m --sense a",
                dir.path().display()
            )]
        );
    }

    #[cfg(unix)]
    fn collect_scoped(folder: &Path, command: &Path, modules: &[String]) -> (ScanRun, Vec<String>) {
        collect_scoped_describing(folder, command, modules, Describe::Stale)
    }

    #[cfg(unix)]
    fn collect_scoped_describing(
        folder: &Path,
        command: &Path,
        modules: &[String],
        describe: Describe,
    ) -> (ScanRun, Vec<String>) {
        let lines = Mutex::new(Vec::new());
        let tools = TempDir::new().unwrap();
        let runner = working_runner(tools.path());
        let result = run_with(
            &ScanRuns::default(),
            "w-1",
            folder,
            &runner,
            &command.display().to_string(),
            describe,
            &[],
            &[],
            Some(modules),
            None,
            || {},
            &|line| lines.lock().unwrap().push(line),
        );

        (result, lines.into_inner().unwrap())
    }

    #[cfg(unix)]
    #[test]
    fn a_describe_all_run_passes_describe_all_with_the_modules() {
        let dir = TempDir::new().unwrap();
        let command = fake_command(dir.path(), r#"echo "$@""#);
        let (_, lines) =
            collect_scoped_describing(dir.path(), &command, &names(&["a.py"]), Describe::All);
        let file = dir.path().join(".recognizer/cache/scan-modules-w-1.json");

        assert_eq!(
            lines,
            vec![format!(
                "scan {} --json --describe=all --modules {}",
                dir.path().display(),
                file.display()
            )]
        );
    }

    #[cfg(unix)]
    #[test]
    fn the_module_ids_reach_the_command_as_a_file_that_is_removed_after_the_run() {
        let dir = TempDir::new().unwrap();
        let command = fake_command(
            dir.path(),
            r#"for last; do :; done; echo "$@"; cat "$last""#,
        );
        let (result, lines) = collect_scoped(dir.path(), &command, &names(&["a.py", "b/c.py"]));
        let file = dir.path().join(".recognizer/cache/scan-modules-w-1.json");

        assert!(matches!(result, ScanRun::Finished { exit_code: 0, .. }));
        assert_eq!(
            lines,
            vec![
                format!(
                    "scan {} --json --describe --modules {}",
                    dir.path().display(),
                    file.display()
                ),
                r#"["a.py","b/c.py"]"#.to_string(),
            ]
        );
        assert!(!file.exists());
        assert!(!dir
            .path()
            .join(".recognizer/cache/scan-modules-w-1.json.tmp")
            .exists());
    }

    #[cfg(unix)]
    #[test]
    fn a_failed_scoped_run_removes_the_module_file() {
        let dir = TempDir::new().unwrap();
        let command = fake_command(dir.path(), "exit 3");
        let (_, _) = collect_scoped(dir.path(), &command, &names(&["a.py"]));

        assert!(!dir
            .path()
            .join(".recognizer/cache/scan-modules-w-1.json")
            .exists());
    }

    #[cfg(unix)]
    #[test]
    fn an_empty_list_an_empty_id_or_a_nul_is_refused_before_anything_is_written() {
        let dir = TempDir::new().unwrap();
        let command = fake_command(dir.path(), "echo ran");

        for bad in [names(&[]), names(&["a.py", ""]), vec!["a\0b".to_string()]] {
            let (result, lines) = collect_scoped(dir.path(), &command, &bad);

            assert!(matches!(result, ScanRun::Refused { .. }));
            assert!(lines.is_empty());
        }

        assert!(!dir.path().join(".recognizer").exists());
    }

    #[cfg(unix)]
    #[test]
    fn the_summary_log_is_returned_as_the_log() {
        let dir = TempDir::new().unwrap();
        let command = fake_command(
            dir.path(),
            r#"echo '{"event":"summary","log":"20261102T123456789Z-scan"}'"#,
        );
        let (result, _) = collect(
            &ScanRuns::default(),
            dir.path(),
            &command,
            Describe::Off,
            &[],
            &[],
        );

        assert_eq!(
            result,
            ScanRun::Finished {
                exit_code: 0,
                stderr: String::new(),
                log: Some(format!("{LOG}/20261102T123456789Z-scan.json"))
            }
        );
    }

    #[cfg(unix)]
    #[test]
    fn exit_two_is_failed_with_stderr_and_127_is_missing() {
        let dir = TempDir::new().unwrap();
        let command = fake_command(dir.path(), "echo bad flag >&2; exit 2");
        let (result, _) = collect(
            &ScanRuns::default(),
            dir.path(),
            &command,
            Describe::Off,
            &[],
            &[],
        );

        assert_eq!(
            result,
            ScanRun::Failed {
                exit_code: 2,
                stderr: "bad flag\n".into()
            }
        );

        let (missing, _) = collect(
            &ScanRuns::default(),
            dir.path(),
            Path::new("/nonexistent/recognizer"),
            Describe::Off,
            &[],
            &[],
        );

        assert!(matches!(missing, ScanRun::CommandMissing { .. }));
    }

    #[cfg(unix)]
    #[test]
    fn a_second_run_is_refused_and_stop_kills_the_first() {
        let dir = TempDir::new().unwrap();
        let command = fake_command(dir.path(), "echo started; sleep 30");
        let runs = Arc::new(ScanRuns::default());
        let runner = Arc::new(working_runner(dir.path()));
        let (sender, receiver) = mpsc::channel();
        let folder = dir.path().to_path_buf();
        let path = command.clone();
        let worker = {
            let runs = Arc::clone(&runs);
            let runner = Arc::clone(&runner);

            std::thread::spawn(move || {
                run_with(
                    &runs,
                    "w-1",
                    &folder,
                    &runner,
                    &path.display().to_string(),
                    Describe::Off,
                    &[],
                    &[],
                    None,
                    None,
                    || {},
                    &|line| {
                        let _ = sender.send(line);
                    },
                )
            })
        };

        assert_eq!(receiver.recv().unwrap(), "started");

        let (second, _) = collect(&runs, dir.path(), &command, Describe::Off, &[], &[]);

        assert_eq!(
            second,
            ScanRun::Refused {
                reason: "a scan is already running".into()
            }
        );

        runs.stop("w-1");

        assert_eq!(worker.join().unwrap(), ScanRun::Stopped);
        assert!(!runs.running("w-1"));
    }

    #[cfg(unix)]
    #[test]
    fn answer_describe_reaches_the_waiting_scan_once() {
        let dir = TempDir::new().unwrap();
        let command = fake_command(
            dir.path(),
            "echo waiting; read answer; echo \"got $answer\"",
        );
        let runs = Arc::new(ScanRuns::default());
        let runner = Arc::new(working_runner(dir.path()));
        let (sender, receiver) = mpsc::channel();
        let folder = dir.path().to_path_buf();
        let path = command.clone();
        let worker = {
            let runs = Arc::clone(&runs);
            let runner = Arc::clone(&runner);

            std::thread::spawn(move || {
                run_with(
                    &runs,
                    "w-1",
                    &folder,
                    &runner,
                    &path.display().to_string(),
                    Describe::Stale,
                    &[],
                    &[],
                    None,
                    Some(5.0),
                    || {},
                    &|line| {
                        let _ = sender.send(line);
                    },
                )
            })
        };

        assert_eq!(receiver.recv().unwrap(), "waiting");
        assert!(runs.answer_describe("w-1", false).is_ok());
        assert!(runs.answer_describe("w-1", false).is_err());
        assert_eq!(receiver.recv().unwrap(), "got skip");
        assert!(matches!(
            worker.join().unwrap(),
            ScanRun::Finished { exit_code: 0, .. }
        ));
    }

    #[cfg(unix)]
    #[test]
    fn stopping_while_waiting_for_an_answer_ends_the_scan() {
        let dir = TempDir::new().unwrap();
        let command = fake_command(dir.path(), "echo waiting; read answer");
        let runs = Arc::new(ScanRuns::default());
        let runner = Arc::new(working_runner(dir.path()));
        let (sender, receiver) = mpsc::channel();
        let folder = dir.path().to_path_buf();
        let path = command.clone();
        let worker = {
            let runs = Arc::clone(&runs);
            let runner = Arc::clone(&runner);

            std::thread::spawn(move || {
                run_with(
                    &runs,
                    "w-1",
                    &folder,
                    &runner,
                    &path.display().to_string(),
                    Describe::All,
                    &[],
                    &[],
                    None,
                    Some(5.0),
                    || {},
                    &|line| {
                        let _ = sender.send(line);
                    },
                )
            })
        };

        assert_eq!(receiver.recv().unwrap(), "waiting");

        runs.stop("w-1");

        assert_eq!(worker.join().unwrap(), ScanRun::Stopped);
        assert!(runs.answer_describe("w-1", true).is_err());
    }

    #[test]
    fn stopping_with_no_run_does_nothing() {
        let runs = ScanRuns::default();

        runs.stop("w-1");

        assert!(!runs.running("w-1"));
        assert!(runs.begin("w-1").is_ok());
        assert!(runs.begin("w-1").is_err());
        assert!(!runs.finish("w-1"));
    }
}
