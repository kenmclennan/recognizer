use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{ChildStdin, Command, Stdio};
use std::sync::Mutex;

use serde::Serialize;

use crate::fs_safe::write_atomic;
use crate::repository::{missing_hint, scan_args, strip_escapes, Describe};
use crate::tool_runner::{ToolFault, ToolRunner};

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
    NothingRan {
        phases: Vec<String>,
        detail: String,
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

    pub fn in_progress(&self, label: &str) -> bool {
        self.lock().get(label).is_some_and(|handle| !handle.stopped)
    }

    pub fn in_progress_labels(&self) -> Vec<String> {
        self.lock()
            .iter()
            .filter(|(_, handle)| !handle.stopped)
            .map(|(label, _)| label.clone())
            .collect()
    }

    pub fn stop_all(&self) {
        let labels: Vec<String> = self.lock().keys().cloned().collect();

        for label in labels {
            self.stop(&label);
        }
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

pub fn summary_event(line: &str) -> Option<serde_json::Value> {
    let event: serde_json::Value = serde_json::from_str(line).ok()?;

    (event.get("event")?.as_str()? == "summary").then_some(event)
}

pub fn requested_phases(
    describe: Describe,
    measure: &[String],
    sense: &[String],
) -> Vec<&'static str> {
    let mut phases = Vec::new();

    if describe != Describe::Off {
        phases.push("describe");
    }

    if !measure.is_empty() {
        phases.push("measure");
    }

    if !sense.is_empty() {
        phases.push("sense");
    }

    phases
}

pub fn nothing_ran(
    requested: &[&str],
    summary: Option<&serde_json::Value>,
) -> Option<(Vec<String>, String)> {
    let ran = |phase: &str| {
        summary
            .and_then(|event| event.get("phases")?.as_array())
            .is_some_and(|phases| {
                phases.iter().any(|entry| {
                    entry.get("phase").and_then(|name| name.as_str()) == Some(phase)
                        && entry
                            .get("entries")
                            .and_then(|entries| entries.as_array())
                            .is_some_and(|entries| !entries.is_empty())
                })
            })
    };
    let committed = summary
        .and_then(|event| event.get("commit"))
        .is_some_and(|commit| !commit.is_null());
    let idle: Vec<&str> = requested
        .iter()
        .copied()
        .filter(|phase| !ran(phase))
        .collect();

    if idle.is_empty() {
        return None;
    }

    let detail = idle
        .iter()
        .map(|phase| {
            let cause = if summary.is_none() {
                "it printed no summary"
            } else if *phase != "describe" && !committed {
                "the folder has no commit"
            } else {
                "it ran no entries"
            };

            format!("{phase} did not run: {cause}")
        })
        .collect::<Vec<_>>()
        .join("; ");

    Some((idle.iter().map(|phase| phase.to_string()).collect(), detail))
}

fn refusal(fault: ToolFault) -> ScanRun {
    match fault {
        ToolFault::Missing { .. } => ScanRun::CommandMissing {
            hint: fault.message(),
        },
        other => ScanRun::Refused {
            reason: other.message(),
        },
    }
}

fn result_for(
    exit: Option<i32>,
    stopped: bool,
    stderr: String,
    log: Option<String>,
    idle: Option<(Vec<String>, String)>,
) -> ScanRun {
    if stopped {
        return ScanRun::Stopped;
    }

    match exit {
        Some(127) => ScanRun::CommandMissing {
            hint: missing_hint(),
        },
        Some(0 | 1) if idle.is_some() => {
            let (phases, detail) = idle.unwrap_or_default();

            ScanRun::NothingRan { phases, detail }
        }
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

    if let Err(fault) = runner.check_all() {
        return refusal(fault);
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
    let mut process = match runner.command(command) {
        Ok(process) => process,
        Err(fault) => return refusal(fault),
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
    let mut summary = None;

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

                    if let Some(event) = summary_event(&line) {
                        summary = Some(event);
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

    let idle = nothing_ran(
        &requested_phases(describe, measure, sense),
        summary.as_ref(),
    );

    result_for(exit, stopped, stderr_text, log, idle)
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

    #[test]
    fn a_run_counts_as_in_progress_until_it_is_stopped() {
        let runs = ScanRuns::default();

        assert!(!runs.in_progress("w-1"));

        runs.begin("w-1").unwrap();

        assert!(runs.in_progress("w-1"));

        runs.stop("w-1");

        assert!(!runs.in_progress("w-1"));
        assert!(runs.running("w-1"));
    }

    #[test]
    fn a_stopped_run_is_not_listed_as_in_progress() {
        let runs = ScanRuns::default();

        runs.begin("w-1").unwrap();
        runs.begin("w-2").unwrap();
        runs.stop("w-2");

        assert_eq!(runs.in_progress_labels(), vec!["w-1".to_string()]);
    }

    #[test]
    fn stop_all_stops_every_run() {
        let runs = ScanRuns::default();

        runs.begin("w-1").unwrap();
        runs.begin("w-2").unwrap();
        runs.stop("w-2");
        runs.stop_all();

        assert!(runs.in_progress_labels().is_empty());
        assert!(!runs.in_progress("w-1"));
    }

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
            r#"for last; do :; done; echo "$@"; cat "$last"; echo; echo '{"event":"summary","commit":"c","phases":[{"phase":"describe","entries":[{}]}],"log":null}'"#,
        );
        let (result, mut lines) = collect_scoped(dir.path(), &command, &names(&["a.py", "b/c.py"]));

        lines.pop();

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
            "echo waiting; read answer; echo \"got $answer\"; echo '{\"event\":\"summary\",\"commit\":\"c\",\"phases\":[{\"phase\":\"describe\",\"entries\":[{}]}],\"log\":null}'",
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

    fn requested(names: &[&'static str]) -> Vec<&'static str> {
        names.to_vec()
    }

    fn summary_with(commit: &str, phases: &str) -> serde_json::Value {
        summary_event(&format!(
            r#"{{"event":"summary","commit":{commit},"phases":{phases},"log":null}}"#
        ))
        .unwrap()
    }

    #[test]
    fn nothing_ran_is_decided_per_requested_phase_from_the_summary() {
        let full = summary_with(
            r#""abc""#,
            r#"[{"phase":"describe","entries":[{}]},{"phase":"sense","entries":[{}]}]"#,
        );

        assert_eq!(
            nothing_ran(&requested(&["describe", "sense"]), Some(&full)),
            None
        );
        assert_eq!(nothing_ran(&[], None), None);

        let absent = summary_with(r#""abc""#, r#"[{"phase":"describe","entries":[{}]}]"#);

        assert_eq!(
            nothing_ran(&requested(&["describe", "sense"]), Some(&absent)),
            Some((
                vec!["sense".to_string()],
                "sense did not run: it ran no entries".to_string()
            ))
        );

        let empty = summary_with(r#""abc""#, r#"[{"phase":"measure","entries":[]}]"#);

        assert_eq!(
            nothing_ran(&requested(&["measure"]), Some(&empty)),
            Some((
                vec!["measure".to_string()],
                "measure did not run: it ran no entries".to_string()
            ))
        );

        let uncommitted = summary_with("null", "[]");

        assert_eq!(
            nothing_ran(&requested(&["sense"]), Some(&uncommitted)),
            Some((
                vec!["sense".to_string()],
                "sense did not run: the folder has no commit".to_string()
            ))
        );
        assert_eq!(
            nothing_ran(&requested(&["describe"]), Some(&uncommitted)),
            Some((
                vec!["describe".to_string()],
                "describe did not run: it ran no entries".to_string()
            ))
        );
        assert_eq!(
            nothing_ran(&requested(&["describe", "sense"]), None),
            Some((
                vec!["describe".to_string(), "sense".to_string()],
                "describe did not run: it printed no summary; sense did not run: it printed no summary"
                    .to_string()
            ))
        );
    }

    #[test]
    fn the_requested_phases_follow_the_describe_mode_and_the_lists() {
        assert!(requested_phases(Describe::Off, &[], &[]).is_empty());
        assert_eq!(
            requested_phases(Describe::Stale, &names(&["m"]), &names(&["s"])),
            vec!["describe", "measure", "sense"]
        );
    }

    #[test]
    fn a_stopped_run_stays_stopped_and_only_an_exit_of_zero_or_one_is_nothing_ran() {
        let idle = || Some((vec!["sense".to_string()], "d".to_string()));

        assert_eq!(
            result_for(Some(0), true, String::new(), None, idle()),
            ScanRun::Stopped
        );
        assert!(matches!(
            result_for(Some(1), false, String::new(), None, idle()),
            ScanRun::NothingRan { .. }
        ));
        assert!(matches!(
            result_for(Some(2), false, String::new(), None, idle()),
            ScanRun::Failed { .. }
        ));
    }

    #[cfg(unix)]
    #[test]
    fn a_scan_that_exits_zero_with_no_summary_for_a_requested_sense_phase_is_nothing_ran() {
        let dir = TempDir::new().unwrap();
        let command = fake_command(
            dir.path(),
            r#"echo '{"event":"summary","commit":null,"phases":[],"log":null}'"#,
        );
        let (result, _) = collect(
            &ScanRuns::default(),
            dir.path(),
            &command,
            Describe::Off,
            &[],
            &names(&["duplication"]),
        );

        assert_eq!(
            result,
            ScanRun::NothingRan {
                phases: vec!["sense".to_string()],
                detail: "sense did not run: the folder has no commit".to_string()
            }
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_refused_scan_starts_no_process_and_leaves_the_window_free() {
        use crate::tool_runner::tests::{bundled_runner, fake_command, fake_commands, runs_of};

        let dir = TempDir::new().unwrap();
        let folder = fake_commands(dir.path(), "1.2.3");

        fake_command(dir.path(), &folder, "recognizer-scan-python", "0.1.108");

        let runner = bundled_runner(dir.path(), &folder, "/usr/bin");
        let runs = ScanRuns::default();
        let result = run_with(
            &runs,
            "w-1",
            dir.path(),
            &runner,
            "recognizer",
            Describe::Off,
            &[],
            &[],
            None,
            None,
            || panic!("prepare must not run"),
            &|_| {},
        );

        match result {
            ScanRun::Refused { reason } => {
                assert!(reason.contains("1.2.3"));
                assert!(reason.contains("0.1.108"));
                assert!(reason.contains("recognizer-scan-python"));
                assert!(reason.contains("brew reinstall --cask kenmclennan/tap/recognizer"));
            }
            other => panic!("expected Refused, got {other:?}"),
        }

        assert!(!runs.running("w-1"));
        assert_eq!(runs_of(dir.path(), "recognizer", "scan-runs"), 0);
    }
}
