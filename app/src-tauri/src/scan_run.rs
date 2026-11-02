use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Read};
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::Mutex;

use serde::Serialize;

use crate::repository::{missing_hint, scan_invocation};

const LOG: &str = ".recognizer/cache/log";

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
}

#[derive(Default)]
pub struct ScanRuns(Mutex<HashMap<String, Handle>>);

fn kill_group(pid: u32) {
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

    pub fn stop(&self, label: &str) {
        let mut runs = self.lock();

        if let Some(handle) = runs.get_mut(label) {
            handle.stopped = true;

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

fn is_scan_record(name: &str) -> bool {
    let Some(stamp) = name.strip_suffix("-scan.json") else {
        return false;
    };
    let bytes = stamp.as_bytes();

    bytes.len() == 19
        && bytes[..8].iter().all(u8::is_ascii_digit)
        && bytes[8] == b'T'
        && bytes[9..18].iter().all(u8::is_ascii_digit)
        && bytes[18] == b'Z'
}

pub fn log_names(folder: &Path) -> Vec<String> {
    fs::read_dir(folder.join(LOG))
        .map(|entries| {
            entries
                .filter_map(|entry| entry.ok()?.file_name().into_string().ok())
                .filter(|name| name.ends_with(".json"))
                .collect()
        })
        .unwrap_or_default()
}

pub fn new_scan_record(before: &[String], after: &[String]) -> Option<String> {
    let mut fresh = after
        .iter()
        .filter(|name| is_scan_record(name) && !before.contains(name));
    let first = fresh.next()?;

    if fresh.next().is_some() {
        return None;
    }

    Some(format!("{LOG}/{first}"))
}

fn result_for(
    exit: Option<i32>,
    stopped: bool,
    stderr: String,
    log: impl FnOnce() -> Option<String>,
) -> ScanRun {
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
            log: log(),
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
    shell: &str,
    command: &str,
    describe: bool,
    sense: &[String],
    prepare: impl FnOnce(),
    emit: &(dyn Fn(String) + Sync),
) -> ScanRun {
    if let Err(reason) = runs.begin(label) {
        return ScanRun::Refused { reason };
    }

    prepare();

    let result = spawn_and_stream(runs, label, folder, shell, command, describe, sense, emit);

    runs.finish(label);

    result
}

#[allow(clippy::too_many_arguments)]
fn spawn_and_stream(
    runs: &ScanRuns,
    label: &str,
    folder: &Path,
    shell: &str,
    command: &str,
    describe: bool,
    sense: &[String],
    emit: &(dyn Fn(String) + Sync),
) -> ScanRun {
    let before = log_names(folder);
    let (program, args) = scan_invocation(shell, command, folder, describe, sense);
    let mut process = Command::new(program);

    process
        .args(args)
        .stdin(Stdio::null())
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

    runs.started(label, child.id());

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

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
                if !line.trim().is_empty() {
                    emit(line);
                }
            }
        }

        let status = child.wait();

        (collected.join().unwrap_or_default(), status)
    });

    let stopped = runs.lock().get(label).is_some_and(|handle| handle.stopped);
    let exit = status.ok().and_then(|status| status.code());

    result_for(exit, stopped, stderr_text, || {
        new_scan_record(&before, &log_names(folder))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::mpsc;
    use std::sync::Arc;
    use tempfile::TempDir;

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
        describe: bool,
        sense: &[String],
    ) -> (ScanRun, Vec<String>) {
        let lines = Mutex::new(Vec::new());
        let result = run_with(
            runs,
            "w-1",
            folder,
            "/bin/sh",
            &command.display().to_string(),
            describe,
            sense,
            || {},
            &|line| lines.lock().unwrap().push(line),
        );

        (result, lines.into_inner().unwrap())
    }

    #[test]
    fn a_scan_record_is_the_one_new_timestamped_scan_name() {
        let record = "20261102T123456789Z-scan.json";

        assert_eq!(
            new_scan_record(&names(&["a.json"]), &names(&["a.json", record])),
            Some(format!("{LOG}/{record}"))
        );
        assert_eq!(new_scan_record(&names(&[record]), &names(&[record])), None);
        assert_eq!(
            new_scan_record(&[], &names(&[record, "20261102T123456790Z-scan.json"])),
            None
        );
        assert_eq!(
            new_scan_record(&[], &names(&["20261102T123456789Z-describe.json"])),
            None
        );
        assert_eq!(
            new_scan_record(&[], &names(&["scan.json", "x-scan.json"])),
            None
        );
    }

    #[test]
    fn the_log_listing_reads_json_names_and_a_missing_folder_reads_empty() {
        let dir = TempDir::new().unwrap();

        assert_eq!(log_names(dir.path()), Vec::<String>::new());

        fs::create_dir_all(dir.path().join(LOG)).unwrap();
        fs::write(dir.path().join(LOG).join("a.json"), "{}").unwrap();
        fs::write(dir.path().join(LOG).join("b.txt"), "x").unwrap();

        assert_eq!(log_names(dir.path()), names(&["a.json"]));
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
    fn lines_are_emitted_in_order_and_exit_one_is_finished() {
        let dir = TempDir::new().unwrap();
        let command = fake_command(
            dir.path(),
            r#"echo '{"event":"phase"}'; echo '{"event":"summary"}'; exit 1"#,
        );
        let (result, lines) = collect(&ScanRuns::default(), dir.path(), &command, false, &[]);

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
            true,
            &names(&["a"]),
        );

        assert_eq!(
            lines,
            vec![format!(
                "scan {} --json --describe --sense a",
                dir.path().display()
            )]
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_new_scan_record_is_returned_as_the_log() {
        let dir = TempDir::new().unwrap();
        let command = fake_command(
            dir.path(),
            &format!(
                "mkdir -p \"{0}/{1}\"; echo '{{}}' > \"{0}/{1}/20261102T123456789Z-scan.json\"",
                dir.path().display(),
                LOG
            ),
        );
        let (result, _) = collect(&ScanRuns::default(), dir.path(), &command, false, &[]);

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
        let (result, _) = collect(&ScanRuns::default(), dir.path(), &command, false, &[]);

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
            false,
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
        let (sender, receiver) = mpsc::channel();
        let folder = dir.path().to_path_buf();
        let path = command.clone();
        let worker = {
            let runs = Arc::clone(&runs);

            std::thread::spawn(move || {
                run_with(
                    &runs,
                    "w-1",
                    &folder,
                    "/bin/sh",
                    &path.display().to_string(),
                    false,
                    &[],
                    || {},
                    &|line| {
                        let _ = sender.send(line);
                    },
                )
            })
        };

        assert_eq!(receiver.recv().unwrap(), "started");

        let (second, _) = collect(&runs, dir.path(), &command, false, &[]);

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
