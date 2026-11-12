use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::process::{ChildStdin, Command, Stdio};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::fs_safe::write_atomic;
use crate::repository::{missing_hint, scan_args, strip_escapes, Describe};
use crate::tool_runner::{ToolFault, ToolRunner};

const LOG: &str = ".recognizer/cache/log";
const MODULES_DIR: &str = ".recognizer/cache";
const MARKER: &str = ".recognizer/cache/scan-running.json";
const MARKER_PROGRESS: &str = ".recognizer/cache/scan-running.progress.jsonl";
const REFUSED_EXIT: i32 = 3;
const PREFLIGHT_EXIT: i32 = 4;
const STARTED_BY: &str = "RECOGNIZER_STARTED_BY";

const PHASES: [&str; 6] = [
    "checking", "refused", "running", "finished", "failed", "stopped",
];
const START_SLACK_SECONDS: i64 = 5;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RunGap {
    pub id: String,
    pub line: String,
    pub needs: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RunFailure {
    pub sensor: String,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ScanRunRecord {
    pub version: u32,
    pub run_id: String,
    pub pid: u32,
    pub pgid: Option<u32>,
    pub started_at: String,
    pub started_by: String,
    pub repository: String,
    pub sensors: Vec<String>,
    pub describe: bool,
    pub phase: String,
    pub ended_at: Option<String>,
    pub exit: Option<i32>,
    pub gaps: Vec<RunGap>,
    pub failure: Option<RunFailure>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum RunEmission {
    Run(Option<Box<ScanRunRecord>>),
    Line(String),
}

#[derive(Default)]
pub struct RunSeen {
    folder: Option<PathBuf>,
    run: Option<ScanRunRecord>,
    offset: u64,
}

pub fn parse_run(text: &str) -> Option<ScanRunRecord> {
    let run: ScanRunRecord = serde_json::from_str(text).ok()?;

    if run.version != 2
        || run.run_id.is_empty()
        || run.pid == 0
        || run.pgid == Some(0)
        || run.repository.is_empty()
        || !matches!(run.started_by.as_str(), "cli" | "app")
        || !PHASES.contains(&run.phase.as_str())
        || !timestamp_ok(&run.started_at)
        || run.ended_at.as_deref().is_some_and(|at| !timestamp_ok(at))
        || run.sensors.iter().any(String::is_empty)
        || run
            .gaps
            .iter()
            .any(|gap| gap.id.is_empty() || gap.needs.iter().any(String::is_empty))
        || run
            .failure
            .as_ref()
            .is_some_and(|failure| failure.sensor.is_empty())
    {
        return None;
    }

    Some(run)
}

fn timestamp_ok(text: &str) -> bool {
    let shape = b"dddd-dd-ddTdd:dd:dd.dddZ";

    text.len() == shape.len()
        && text.bytes().zip(shape).all(|(byte, kind)| match kind {
            b'd' => byte.is_ascii_digit(),
            other => byte == *other,
        })
}

fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = year.div_euclid(400);
    let year_of_era = year - era * 400;
    let shifted = if month > 2 { month - 3 } else { month + 9 };
    let day_of_year = (153 * shifted + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;

    era * 146_097 + day_of_era - 719_468
}

fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let shifted = days + 719_468;
    let era = shifted.div_euclid(146_097);
    let day_of_era = shifted - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_shifted = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_shifted + 2) / 5 + 1;
    let month = if month_shifted < 10 {
        month_shifted + 3
    } else {
        month_shifted - 9
    };
    let year = year_of_era + era * 400 + i64::from(month <= 2);

    (year, month, day)
}

fn epoch_of_timestamp(text: &str) -> Option<i64> {
    if !timestamp_ok(text) {
        return None;
    }

    let number = |from: usize, to: usize| text[from..to].parse::<i64>().ok();

    Some(
        days_from_civil(number(0, 4)?, number(5, 7)?, number(8, 10)?) * 86_400
            + number(11, 13)? * 3600
            + number(14, 16)? * 60
            + number(17, 19)?,
    )
}

fn timestamp_of_epoch(seconds: i64) -> String {
    let (year, month, day) = civil_from_days(seconds.div_euclid(86_400));
    let in_day = seconds.rem_euclid(86_400);

    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.000Z",
        in_day / 3600,
        in_day % 3600 / 60,
        in_day % 60
    )
}

fn epoch_of_lstart(text: &str) -> Option<i64> {
    let words: Vec<&str> = text.split_whitespace().collect();

    if words.len() != 5 {
        return None;
    }

    let months = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    let (month_word, day_word) = if months.contains(&words[1]) {
        (words[1], words[2])
    } else {
        (words[2], words[1])
    };
    let month = months.iter().position(|name| *name == month_word)? as i64 + 1;
    let day = day_word.parse::<i64>().ok()?;
    let year = words[4].parse::<i64>().ok()?;
    let mut clock = words[3].split(':').map(|part| part.parse::<i64>().ok());
    let (hours, minutes, seconds) = (clock.next()??, clock.next()??, clock.next()??);

    Some(days_from_civil(year, month, day) * 86_400 + hours * 3600 + minutes * 60 + seconds)
}

pub fn started_no_later_than(lstart: &str, started_at: &str) -> bool {
    match (epoch_of_lstart(lstart), epoch_of_timestamp(started_at)) {
        (Some(start), Some(recorded)) => start <= recorded + START_SLACK_SECONDS,
        _ => true,
    }
}

pub fn pid_alive(pid: u32) -> bool {
    Command::new("/bin/kill")
        .args(["-0"])
        .arg(pid.to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|status| status.success())
}

fn process_lstart(pid: u32) -> Option<String> {
    let output = Command::new("/bin/ps")
        .env("TZ", "UTC")
        .args(["-o", "lstart=", "-p"])
        .arg(pid.to_string())
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .ok()?;

    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn process_is_the_scan(run: &ScanRunRecord) -> bool {
    pid_alive(run.pid)
        && process_lstart(run.pid)
            .is_none_or(|lstart| started_no_later_than(&lstart, &run.started_at))
}

pub fn is_active(run: &ScanRunRecord) -> bool {
    matches!(run.phase.as_str(), "checking" | "running")
}

fn progress_ended_at(folder: &Path, started_at: &str) -> String {
    fs::metadata(folder.join(MARKER_PROGRESS))
        .and_then(|meta| meta.modified())
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or_else(
            || started_at.to_string(),
            |since| timestamp_of_epoch(since.as_secs() as i64),
        )
}

pub fn read_run(folder: &Path) -> Option<ScanRunRecord> {
    let text = fs::read_to_string(folder.join(MARKER)).ok()?;
    let mut run = parse_run(&text)?;

    if is_active(&run) && !process_is_the_scan(&run) {
        run.phase = "stopped".to_string();
        run.ended_at = Some(progress_ended_at(folder, &run.started_at));
    }

    Some(run)
}

pub fn live_run(folder: &Path) -> Option<ScanRunRecord> {
    read_run(folder).filter(is_active)
}

pub fn refusal_text(run: &ScanRunRecord, folder: &Path) -> String {
    let who = if run.started_by == "app" {
        "the app"
    } else {
        "the command line"
    };

    format!(
        "a scan is already running on {}: started from {who} at {}, process {}; remove {} if that process is not a scan",
        run.repository,
        run.started_at,
        run.pid,
        folder.join(MARKER).display()
    )
}

fn appended_lines(folder: &Path, offset: u64) -> (Vec<String>, u64) {
    let Ok(mut file) = fs::File::open(folder.join(MARKER_PROGRESS)) else {
        return (Vec::new(), offset);
    };
    let length = file.metadata().map(|meta| meta.len()).unwrap_or(0);
    let from = if length < offset { 0 } else { offset };

    if file.seek(SeekFrom::Start(from)).is_err() {
        return (Vec::new(), from);
    }

    let mut bytes = Vec::new();

    if file.read_to_end(&mut bytes).is_err() {
        return (Vec::new(), from);
    }

    let Some(end) = bytes.iter().rposition(|byte| *byte == b'\n') else {
        return (Vec::new(), from);
    };
    let lines = String::from_utf8_lossy(&bytes[..end])
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(strip_escapes)
        .collect();

    (lines, from + end as u64 + 1)
}

pub fn run_tick(folder: Option<&Path>, seen: &mut RunSeen) -> Vec<RunEmission> {
    let mut out = Vec::new();

    if seen.folder.as_deref() != folder {
        if seen.run.take().is_some() {
            out.push(RunEmission::Run(None));
        }

        seen.folder = folder.map(Path::to_path_buf);
        seen.offset = 0;
    }

    match (folder.and_then(read_run), folder) {
        (Some(run), Some(folder)) => {
            if seen.run.as_ref().map(|last| &last.run_id) != Some(&run.run_id) {
                seen.offset = 0;
            }

            if seen.run.as_ref() != Some(&run) {
                out.push(RunEmission::Run(Some(Box::new(run.clone()))));
                seen.run = Some(run);
            }

            let (lines, offset) = appended_lines(folder, seen.offset);

            seen.offset = offset;
            out.extend(lines.into_iter().map(RunEmission::Line));
        }
        _ => {
            if seen.run.take().is_some() {
                seen.offset = 0;
                out.push(RunEmission::Run(None));
            }
        }
    }

    out
}

pub fn stop_scan_for(runs: &ScanRuns, label: &str, folder: Option<&Path>) {
    runs.stop(label);

    if let Some(run) = folder.and_then(live_run) {
        if run.pgid == Some(run.pid) {
            kill_group(run.pid);
        } else {
            kill_pid(run.pid);
        }
    }
}

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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Gap {
    pub id: String,
    pub line: String,
    pub needs: Vec<String>,
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
    Gaps {
        gaps: Vec<Gap>,
    },
}

#[derive(Default)]
struct Handle {
    pid: Option<u32>,
    stopped: bool,
    stdin: Option<ChildStdin>,
}

#[derive(Default)]
pub struct ScanRuns {
    handles: Mutex<HashMap<String, Handle>>,
}

pub fn kill_pid(pid: u32) {
    let _ = Command::new("/bin/kill")
        .args(["-TERM", "--"])
        .arg(pid.to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

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
        self.handles
            .lock()
            .unwrap_or_else(|error| error.into_inner())
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

pub fn preflight_gaps(line: &str) -> Option<Vec<Gap>> {
    let event: serde_json::Value = serde_json::from_str(line).ok()?;

    if event.get("event")?.as_str()? != "preflight" || event.get("state")?.as_str()? != "gaps" {
        return None;
    }

    serde_json::from_value(event.get("gaps")?.clone()).ok()
}

fn fault_gap(fault: &ToolFault, needs: Vec<String>) -> Gap {
    Gap {
        id: fault.gap_id(),
        line: fault.message(),
        needs,
    }
}

fn ticked(describe: Describe, measure: &[String], sense: &[String]) -> Vec<String> {
    let mut names: Vec<String> = measure.iter().chain(sense).cloned().collect();

    if describe != Describe::Off {
        names.push("describe".to_string());
    }

    if names.is_empty() {
        names.push("scan".to_string());
    }

    names
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
        Some(REFUSED_EXIT) => ScanRun::Refused {
            reason: stderr.trim().to_string(),
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
        return ScanRun::Gaps {
            gaps: vec![fault_gap(&fault, ticked(describe, measure, sense))],
        };
    }

    if let Some(run) = live_run(folder) {
        return ScanRun::Refused {
            reason: refusal_text(&run, folder),
        };
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
        .env(STARTED_BY, "app")
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
    let mut gaps = None;

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

                    if let Some(found) = preflight_gaps(&line) {
                        gaps = Some(found);
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

    if exit == Some(PREFLIGHT_EXIT) && !stopped {
        return match gaps {
            Some(gaps) => ScanRun::Gaps { gaps },
            None => ScanRun::Failed {
                exit_code: PREFLIGHT_EXIT,
                stderr: stderr_text,
            },
        };
    }

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

        match &result {
            ScanRun::Gaps { gaps } => {
                assert_eq!(gaps.len(), 1);
                assert_eq!(gaps[0].id, "toolchain:recognizer-scan-python");
                assert_eq!(gaps[0].needs, vec!["scan".to_string()]);
                assert!(gaps[0].line.contains("1.2.3"));
                assert!(gaps[0].line.contains("0.1.108"));
                assert!(gaps[0].line.contains("recognizer-scan-python"));
            }
            other => panic!("expected Gaps, got {other:?}"),
        }

        assert!(!runs.running("w-1"));
        assert_eq!(runs_of(dir.path(), "recognizer", "scan-runs"), 0);
    }

    fn now_timestamp() -> String {
        timestamp_of_epoch(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs() as i64,
        )
    }

    fn run_text(
        pid: u32,
        pgid: Option<u32>,
        phase: &str,
        started_by: &str,
        run_id: &str,
        started_at: &str,
    ) -> String {
        let pgid = pgid.map_or("null".to_string(), |group| group.to_string());

        format!(
            r#"{{"version":2,"run_id":"{run_id}","pid":{pid},"pgid":{pgid},"started_at":"{started_at}","started_by":"{started_by}","repository":"/work/shop","sensors":["crap"],"describe":true,"phase":"{phase}","ended_at":null,"exit":null,"gaps":[],"failure":null}}"#
        )
    }

    fn write_run_with(folder: &Path, text: &str) {
        let cache = folder.join(MODULES_DIR);

        fs::create_dir_all(&cache).unwrap();
        fs::write(folder.join(MARKER), text).unwrap();

        if !folder.join(MARKER_PROGRESS).exists() {
            fs::write(folder.join(MARKER_PROGRESS), "").unwrap();
        }
    }

    fn write_run(folder: &Path, pid: u32, phase: &str, started_by: &str) {
        write_run_with(
            folder,
            &run_text(pid, Some(pid), phase, started_by, "run-1", &now_timestamp()),
        );
    }

    fn write_marker(folder: &Path, pid: u32, started_by: &str) {
        write_run(folder, pid, "running", started_by);
    }

    fn append_progress(folder: &Path, text: &str) {
        let mut file = fs::OpenOptions::new()
            .append(true)
            .open(folder.join(MARKER_PROGRESS))
            .unwrap();

        file.write_all(text.as_bytes()).unwrap();
    }

    fn dead_pid() -> u32 {
        let mut child = Command::new("/usr/bin/true").spawn().unwrap();
        let pid = child.id();

        child.wait().unwrap();

        pid
    }

    fn examples(kind: &str) -> Vec<String> {
        let directory = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../schema/scan-marker-examples")
            .join(kind);
        let mut texts: Vec<String> = fs::read_dir(directory)
            .unwrap()
            .map(|entry| fs::read_to_string(entry.unwrap().path()).unwrap())
            .collect();

        texts.sort();

        texts
    }

    #[test]
    fn every_valid_example_run_parses_and_every_invalid_one_is_rejected() {
        let valid = examples("valid");
        let invalid = examples("invalid");

        assert_eq!(valid.len(), 6);
        assert_eq!(invalid.len(), 6);
        assert!(valid.iter().all(|text| parse_run(text).is_some()));
        assert!(invalid.iter().all(|text| parse_run(text).is_none()));

        let mut phases: Vec<String> = valid
            .iter()
            .map(|text| parse_run(text).unwrap().phase)
            .collect();

        phases.sort();

        assert_eq!(
            phases,
            vec!["checking", "failed", "finished", "refused", "running", "stopped"]
        );
    }

    #[test]
    fn a_live_run_from_another_process_is_read_with_its_progress_replayed() {
        let dir = TempDir::new().unwrap();
        let mut child = Command::new("/bin/sleep").arg("30").spawn().unwrap();
        let mut seen = RunSeen::default();

        write_marker(dir.path(), child.id(), "cli");
        append_progress(dir.path(), "{\"event\":\"phase\"}\n{\"event\":\"st");

        let first = run_tick(Some(dir.path()), &mut seen);

        assert_eq!(first.len(), 2);
        assert!(matches!(
            &first[0],
            RunEmission::Run(Some(run)) if run.pid == child.id() && run.phase == "running"
        ));
        assert_eq!(
            first[1],
            RunEmission::Line("{\"event\":\"phase\"}".to_string())
        );

        append_progress(dir.path(), "art\"}\n");

        assert_eq!(
            run_tick(Some(dir.path()), &mut seen),
            vec![RunEmission::Line("{\"event\":\"start\"}".to_string())]
        );
        assert!(run_tick(Some(dir.path()), &mut seen).is_empty());

        write_run(dir.path(), child.id(), "finished", "cli");

        let ended = run_tick(Some(dir.path()), &mut seen);

        assert_eq!(ended.len(), 1);
        assert!(matches!(
            &ended[0],
            RunEmission::Run(Some(run)) if run.phase == "finished"
        ));
        assert!(run_tick(Some(dir.path()), &mut seen).is_empty());

        child.kill().unwrap();
        child.wait().unwrap();
    }

    #[test]
    fn a_run_whose_process_is_dead_reads_stopped() {
        let dir = TempDir::new().unwrap();

        write_marker(dir.path(), dead_pid(), "cli");

        let run = read_run(dir.path()).unwrap();
        let modified = fs::metadata(dir.path().join(MARKER_PROGRESS))
            .unwrap()
            .modified()
            .unwrap()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;

        assert_eq!(run.phase, "stopped");
        assert_eq!(run.ended_at, Some(timestamp_of_epoch(modified)));
        assert!(live_run(dir.path()).is_none());
    }

    #[test]
    fn a_running_record_naming_this_process_reads_running() {
        let dir = TempDir::new().unwrap();

        write_marker(dir.path(), std::process::id(), "app");

        assert_eq!(read_run(dir.path()).unwrap().phase, "running");
    }

    #[test]
    fn a_dead_run_with_no_progress_file_ends_when_it_started() {
        let dir = TempDir::new().unwrap();

        write_run_with(
            dir.path(),
            &run_text(
                dead_pid(),
                None,
                "checking",
                "cli",
                "run-1",
                "2026-11-12T09:00:00.000Z",
            ),
        );
        fs::remove_file(dir.path().join(MARKER_PROGRESS)).unwrap();

        assert_eq!(
            read_run(dir.path()).unwrap().ended_at,
            Some("2026-11-12T09:00:00.000Z".to_string())
        );
    }

    #[test]
    fn a_process_that_started_long_after_the_run_is_a_recycled_pid() {
        let recorded = "2026-11-12T09:00:00.000Z";

        assert!(started_no_later_than("Thu Nov 12 09:00:00 2026", recorded));
        assert!(started_no_later_than("Thu Nov 12 08:00:00 2026", recorded));
        assert!(!started_no_later_than("Thu Nov 12 09:00:10 2026", recorded));
        assert!(started_no_later_than("Thu Nov 12 09:00:05 2026", recorded));
        assert!(!started_no_later_than("Thu Nov 12 09:00:06 2026", recorded));
        assert!(started_no_later_than("Thu Nov  5 09:00:06 2026", recorded));
        assert!(started_no_later_than("Thu 12 Nov 09:00:05 2026", recorded));
        assert!(!started_no_later_than("Thu 12 Nov 09:00:06 2026", recorded));
    }

    #[test]
    fn a_live_pid_that_started_after_the_record_reads_stopped() {
        let dir = TempDir::new().unwrap();

        write_run_with(
            dir.path(),
            &run_text(
                std::process::id(),
                None,
                "running",
                "cli",
                "run-1",
                "2020-01-01T00:00:00.000Z",
            ),
        );

        assert_eq!(read_run(dir.path()).unwrap().phase, "stopped");
    }

    #[test]
    fn a_new_run_id_replays_its_progress_from_the_start() {
        let dir = TempDir::new().unwrap();
        let mut seen = RunSeen::default();

        write_run_with(
            dir.path(),
            &run_text(
                std::process::id(),
                None,
                "running",
                "cli",
                "run-1",
                &now_timestamp(),
            ),
        );
        append_progress(dir.path(), "{\"event\":\"one\"}\n");

        assert_eq!(run_tick(Some(dir.path()), &mut seen).len(), 2);

        write_run_with(
            dir.path(),
            &run_text(
                std::process::id(),
                None,
                "running",
                "cli",
                "run-2",
                &now_timestamp(),
            ),
        );

        let second = run_tick(Some(dir.path()), &mut seen);

        assert_eq!(second.len(), 2);
        assert_eq!(
            second[1],
            RunEmission::Line("{\"event\":\"one\"}".to_string())
        );
    }

    #[test]
    fn leaving_the_folder_clears_the_run() {
        let dir = TempDir::new().unwrap();
        let mut seen = RunSeen::default();

        write_run(dir.path(), std::process::id(), "running", "cli");
        run_tick(Some(dir.path()), &mut seen);

        assert_eq!(run_tick(None, &mut seen), vec![RunEmission::Run(None)]);
        assert!(run_tick(None, &mut seen).is_empty());
    }

    struct Reaper(Vec<std::process::Child>);

    impl Drop for Reaper {
        fn drop(&mut self) {
            for child in &mut self.0 {
                let _ = Command::new("/bin/kill")
                    .args(["-KILL", "--"])
                    .arg(format!("-{}", child.id()))
                    .status();
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }

    fn leader() -> std::process::Child {
        use std::os::unix::process::CommandExt;

        Command::new("/bin/sh")
            .args(["-c", "sleep 300 & wait"])
            .process_group(0)
            .spawn()
            .unwrap()
    }

    fn gone(pid: u32) -> bool {
        for _ in 0..600 {
            let mut probe = Command::new("/bin/ps")
                .args(["-o", "stat=", "-p"])
                .arg(pid.to_string())
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .spawn()
                .unwrap();
            let mut text = String::new();

            probe
                .stdout
                .take()
                .unwrap()
                .read_to_string(&mut text)
                .unwrap();
            probe.wait().unwrap();

            if text.trim().is_empty() || text.trim().starts_with('Z') {
                return true;
            }

            std::thread::sleep(std::time::Duration::from_millis(100));
        }

        false
    }

    fn wait_for_children(parent: u32) -> u32 {
        for _ in 0..100 {
            let output = Command::new("/usr/bin/pgrep")
                .args(["-P"])
                .arg(parent.to_string())
                .output()
                .unwrap();

            if let Some(child) = String::from_utf8_lossy(&output.stdout)
                .lines()
                .next()
                .and_then(|line| line.trim().parse::<u32>().ok())
            {
                return child;
            }

            std::thread::sleep(std::time::Duration::from_millis(100));
        }

        panic!("the leader never spawned its child");
    }

    #[test]
    fn stopping_by_record_a_group_leader_takes_its_child_with_it() {
        let dir = TempDir::new().unwrap();
        let runs = ScanRuns::default();
        let mut reaper = Reaper(Vec::new());
        let child = leader();
        let pid = child.id();
        let sleeper = wait_for_children(pid);

        write_run(dir.path(), pid, "running", "cli");
        reaper.0.push(child);

        stop_scan_for(&runs, "w-1", Some(dir.path()));

        assert!(gone(sleeper));
        assert!(gone(pid));
    }

    #[test]
    fn stopping_by_record_a_non_leader_signals_only_the_named_pid() {
        let dir = TempDir::new().unwrap();
        let runs = ScanRuns::default();
        let mut reaper = Reaper(Vec::new());
        let child = Command::new("/bin/sleep").arg("300").spawn().unwrap();
        let pid = child.id();

        reaper.0.push(child);
        write_run_with(
            dir.path(),
            &run_text(pid, Some(1), "running", "cli", "run-1", &now_timestamp()),
        );

        assert!(pid_alive(pid));

        stop_scan_for(&runs, "w-1", Some(dir.path()));

        assert!(gone(pid));
        assert!(pid_alive(std::process::id()));
    }

    #[test]
    fn stopping_signals_the_own_handle_and_the_record_and_survives_neither() {
        let dir = TempDir::new().unwrap();
        let runs = ScanRuns::default();
        let mut reaper = Reaper(Vec::new());
        let own = leader();
        let other = leader();
        let (own_pid, other_pid) = (own.id(), other.id());

        reaper.0.push(own);
        reaper.0.push(other);
        runs.begin("w-1").unwrap();
        runs.started("w-1", own_pid);
        write_run(dir.path(), other_pid, "running", "cli");

        stop_scan_for(&runs, "w-1", Some(dir.path()));

        assert!(gone(own_pid));
        assert!(gone(other_pid));
    }

    #[test]
    fn stopping_with_a_record_and_no_handle_stops_the_record() {
        let dir = TempDir::new().unwrap();
        let runs = ScanRuns::default();
        let mut reaper = Reaper(Vec::new());
        let other = leader();
        let pid = other.id();

        reaper.0.push(other);
        write_run(dir.path(), pid, "running", "cli");

        stop_scan_for(&runs, "w-1", Some(dir.path()));

        assert!(gone(pid));
    }

    #[test]
    fn stopping_with_neither_a_handle_nor_a_live_record_signals_nothing() {
        let dir = TempDir::new().unwrap();
        let runs = ScanRuns::default();

        write_run(dir.path(), std::process::id(), "finished", "cli");
        stop_scan_for(&runs, "w-1", Some(dir.path()));
        stop_scan_for(&runs, "w-1", None);

        assert!(pid_alive(std::process::id()));
    }

    #[test]
    fn run_scan_refuses_while_a_live_marker_exists_before_taking_a_baseline() {
        let dir = TempDir::new().unwrap();
        let runs = ScanRuns::default();
        let prepared = Mutex::new(false);
        let tools = TempDir::new().unwrap();
        let runner = working_runner(tools.path());

        write_marker(dir.path(), std::process::id(), "app");

        let started_at = read_run(dir.path()).unwrap().started_at;
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
            || *prepared.lock().unwrap() = true,
            &|_| {},
        );

        assert_eq!(
            result,
            ScanRun::Refused {
                reason: format!(
                    "a scan is already running on /work/shop: started from the app at {}, process {}; remove {} if that process is not a scan",
                    started_at,
                    std::process::id(),
                    dir.path().join(MARKER).display()
                )
            }
        );
        assert!(!*prepared.lock().unwrap());
        assert!(!runs.running("w-1"));
    }

    #[test]
    fn exit_code_three_is_a_refusal_carrying_the_stderr() {
        assert_eq!(
            result_for(
                Some(3),
                false,
                "a scan is already running\n".to_string(),
                None,
                None
            ),
            ScanRun::Refused {
                reason: "a scan is already running".to_string()
            }
        );
    }

    fn gap(id: &str) -> Gap {
        Gap {
            id: id.to_string(),
            line: "coverage and pytest are not installed".to_string(),
            needs: vec!["crap".to_string()],
        }
    }

    #[test]
    fn gaps_serialise_with_a_status_and_the_gap_shape() {
        let value = serde_json::to_value(ScanRun::Gaps {
            gaps: vec![gap("a")],
        })
        .unwrap();

        assert_eq!(
            value,
            serde_json::json!({
                "status": "gaps",
                "gaps": [{
                    "id": "a",
                    "line": "coverage and pytest are not installed",
                    "needs": ["crap"]
                }]
            })
        );
    }

    #[cfg(unix)]
    #[test]
    fn exit_four_with_a_preflight_event_is_gaps_and_without_one_is_failed() {
        let dir = TempDir::new().unwrap();
        let event = serde_json::json!({
            "event": "preflight",
            "state": "gaps",
            "gaps": [{
                "id": "a",
                "line": "coverage and pytest are not installed",
                "needs": ["crap"],
                "project": {"language": "python", "directory": "sensors"},
                "fix": {
                    "text": "uv sync",
                    "command": ["uv", "sync"],
                    "cwd": "sub",
                    "env": {},
                    "kind": "repository"
                }
            }]
        });
        let with = fake_command(dir.path(), &format!("echo '{event}'\nexit 4"));
        let runs = ScanRuns::default();
        let (result, _) = collect(
            &runs,
            dir.path(),
            &with,
            Describe::Off,
            &[],
            &names(&["crap"]),
        );

        match result {
            ScanRun::Gaps { gaps } => assert_eq!(gaps[0].id, "a"),
            other => panic!("expected Gaps, got {other:?}"),
        }

        let without = fake_command(dir.path(), "echo oops >&2\nexit 4");
        let (result, _) = collect(
            &runs,
            dir.path(),
            &without,
            Describe::Off,
            &[],
            &names(&["crap"]),
        );

        assert!(matches!(result, ScanRun::Failed { exit_code: 4, .. }));
    }
}
