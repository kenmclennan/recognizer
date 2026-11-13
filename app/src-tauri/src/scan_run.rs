use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::fs_safe::write_atomic;
use crate::repository::{missing_hint, scan_args, strip_escapes, Describe};
use crate::tool_runner::{ToolFault, ToolRunner};

const MODULES_DIR: &str = ".recognizer/cache";
const MARKER: &str = ".recognizer/cache/scan-running.json";
const MARKER_PROGRESS: &str = ".recognizer/cache/scan-running.progress.jsonl";
const MARKER_ANSWER: &str = ".recognizer/cache/scan-running.answer.json";
const ACTIVE_POLL: Duration = Duration::from_millis(250);
const IDLE_POLL: Duration = Duration::from_secs(1);
const NO_ANSWER_WAITING: &str = "no scan is waiting for an answer";
const REFUSED_EXIT: i32 = 3;
const PREFLIGHT_EXIT: i32 = 4;
const STARTED_BY: &str = "RECOGNIZER_STARTED_BY";

const PHASES: [&str; 6] = [
    "checking", "refused", "running", "finished", "failed", "stopped",
];
const RAN_PHASES: [&str; 4] = ["extract", "describe", "measure", "sense"];
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
    pub suite: Option<String>,
    pub code: Option<String>,
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
    pub suites: BTreeMap<String, Vec<String>>,
    pub phase: String,
    pub ended_at: Option<String>,
    pub exit: Option<i32>,
    pub gaps: Vec<RunGap>,
    pub failure: Option<RunFailure>,
    pub commit: Option<String>,
    pub ran: Option<Vec<String>>,
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

fn ran_ok(ran: &[String]) -> bool {
    ran.iter()
        .enumerate()
        .all(|(at, name)| RAN_PHASES.contains(&name.as_str()) && !ran[..at].contains(name))
}

pub fn parse_run(text: &str) -> Option<ScanRunRecord> {
    let run: ScanRunRecord = serde_json::from_str(text).ok()?;

    let raw: serde_json::Value = serde_json::from_str(text).ok()?;

    if raw
        .get("failure")
        .and_then(|failure| failure.as_object())
        .is_some_and(|failure| !failure.contains_key("suite") || !failure.contains_key("code"))
    {
        return None;
    }

    if run.version != 5
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
        || run.suites.values().any(|names| {
            names
                .iter()
                .enumerate()
                .any(|(at, name)| name.is_empty() || names[..at].contains(name))
        })
        || run.failure.as_ref().is_some_and(|failure| {
            failure.sensor.is_empty()
                || failure.reason.chars().count() > STDERR_CHARS
                || failure.suite.as_deref().is_some_and(str::is_empty)
                || failure.code.as_deref().is_some_and(str::is_empty)
        })
        || run.commit.as_deref().is_some_and(str::is_empty)
        || run.ran.as_ref().is_some_and(|ran| !ran_ok(ran))
        || (run.phase == "finished" && run.ran.is_none())
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

pub fn poll_interval(seen: &RunSeen) -> Duration {
    if seen.run.as_ref().is_some_and(is_active) {
        ACTIVE_POLL
    } else {
        IDLE_POLL
    }
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

            let changed = seen.run.as_ref() != Some(&run);
            let record = RunEmission::Run(Some(Box::new(run.clone())));
            let (lines, offset) = appended_lines(folder, seen.offset);

            seen.offset = offset;

            if changed && is_active(&run) {
                out.push(record.clone());
            }

            out.extend(lines.into_iter().map(RunEmission::Line));

            if changed && !is_active(&run) {
                out.push(record);
            }

            seen.run = Some(run);
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

pub fn check_suites(suites: &BTreeMap<String, Vec<String>>) -> Result<(), String> {
    let sensors: Vec<String> = suites.keys().cloned().collect();

    crate::sensors::check_names(&sensors)?;

    for names in suites.values() {
        if names.is_empty() {
            return Err("a sensor's suite list is empty".to_string());
        }

        if names
            .iter()
            .any(|name| name.is_empty() || name.chars().count() > 200 || name.contains('\0'))
        {
            return Err("a suite name is empty, over 200 characters or holds a NUL".to_string());
        }
    }

    Ok(())
}

fn suites_file(folder: &Path, label: &str) -> PathBuf {
    let safe: String = label
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
        .collect();

    folder
        .join(MODULES_DIR)
        .join(format!("scan-suites-{safe}.json"))
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

pub type Gap = RunGap;

#[derive(Debug, PartialEq, Serialize)]
#[serde(
    tag = "status",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum ScanRun {
    Finished { exit_code: i32 },
    Stopped,
    CommandMissing { hint: String },
    Failed { exit_code: i32, stderr: String },
    Refused { reason: String },
    Gaps { gaps: Vec<Gap> },
}

#[derive(Default)]
struct Handle {
    pid: Option<u32>,
    stopped: bool,
}

pub struct ScanRuns {
    handles: Mutex<HashMap<String, Handle>>,
    seen: Mutex<HashMap<String, RunSeen>>,
    backstop: Duration,
}

const STOP_BACKSTOP: Duration = Duration::from_secs(15);

impl Default for ScanRuns {
    fn default() -> Self {
        Self::with_backstop(STOP_BACKSTOP)
    }
}

fn kill_group_hard(pid: u32) {
    let _ = Command::new("/bin/kill")
        .args(["-KILL", "--"])
        .arg(format!("-{pid}"))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

fn schedule_backstop(pid: u32, delay: Duration) {
    thread::spawn(move || {
        thread::sleep(delay);

        if pid_alive(pid) {
            kill_group_hard(pid);
        }
    });
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
    pub fn with_backstop(backstop: Duration) -> Self {
        Self {
            handles: Mutex::default(),
            seen: Mutex::default(),
            backstop,
        }
    }

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
                schedule_backstop(pid, self.backstop);
            }
        }
    }

    pub fn tick(&self, label: &str, folder: Option<&Path>) -> Vec<RunEmission> {
        let mut seen = self.seen.lock().unwrap_or_else(|error| error.into_inner());

        run_tick(folder, seen.entry(label.to_string()).or_default())
    }

    pub fn interval(&self, label: &str) -> Duration {
        self.seen
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .get(label)
            .map_or(IDLE_POLL, poll_interval)
    }

    pub fn stop(&self, label: &str) {
        let mut runs = self.lock();

        if let Some(handle) = runs.get_mut(label) {
            handle.stopped = true;

            if let Some(pid) = handle.pid {
                kill_group(pid);
                schedule_backstop(pid, self.backstop);
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

#[derive(Serialize)]
struct AnswerFile<'a> {
    version: u32,
    run_id: &'a str,
    describe: bool,
}

pub fn answer_describe(folder: &Path, describe: bool) -> Result<(), String> {
    let run = live_run(folder)
        .filter(|run| run.phase == "running")
        .ok_or_else(|| NO_ANSWER_WAITING.to_string())?;
    let path = folder.join(MARKER_ANSWER);
    let answered = fs::read_to_string(&path)
        .ok()
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
        .is_some_and(|value| value["run_id"] == run.run_id.as_str());

    if answered {
        return Err("this scan was already answered".to_string());
    }

    let text = serde_json::to_string(&AnswerFile {
        version: 1,
        run_id: &run.run_id,
        describe,
    })
    .map_err(|error| error.to_string())?;

    write_atomic(&path, &format!("{text}\n")).map_err(|error| error.to_string())
}

fn fault_gap(fault: &ToolFault, needs: Vec<String>) -> Gap {
    Gap {
        id: fault.gap_id(),
        line: fault.message(),
        needs,
    }
}

fn ticked(describe: Describe, sense: &[String]) -> Vec<String> {
    let mut names: Vec<String> = sense.to_vec();

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
    own: Option<&ScanRunRecord>,
    owner: Option<&ScanRunRecord>,
    folder: &Path,
) -> ScanRun {
    if stopped {
        return ScanRun::Stopped;
    }

    match exit {
        Some(127) => ScanRun::CommandMissing {
            hint: missing_hint(),
        },
        Some(REFUSED_EXIT) => ScanRun::Refused {
            reason: owner
                .map(|record| refusal_text(record, folder))
                .unwrap_or_else(|| format!("a scan is already running on {}", folder.display())),
        },
        Some(PREFLIGHT_EXIT) => match own {
            Some(record) if record.phase == "refused" && !record.gaps.is_empty() => ScanRun::Gaps {
                gaps: record.gaps.clone(),
            },
            _ => ScanRun::Failed {
                exit_code: PREFLIGHT_EXIT,
                stderr,
            },
        },
        Some(code @ (0 | 1)) => ScanRun::Finished { exit_code: code },
        other => ScanRun::Failed {
            exit_code: other.unwrap_or(-1),
            stderr,
        },
    }
}

const STDERR_CHARS: usize = 8192;
const STDERR_TAIL_BYTES: usize = 4 * STDERR_CHARS;

fn bound_stderr(bytes: &[u8]) -> String {
    let text = String::from_utf8_lossy(bytes);
    let trimmed = text.trim_end();
    let count = trimmed.chars().count();

    if count <= STDERR_CHARS {
        return trimmed.to_string();
    }

    trimmed.chars().skip(count - STDERR_CHARS).collect()
}

fn read_tail(mut source: impl Read) -> Vec<u8> {
    let mut tail: Vec<u8> = Vec::new();
    let mut chunk = [0u8; 4096];

    loop {
        match source.read(&mut chunk) {
            Ok(0) | Err(_) => break,
            Ok(count) => {
                tail.extend_from_slice(&chunk[..count]);

                if tail.len() > STDERR_TAIL_BYTES {
                    tail.drain(..tail.len() - STDERR_TAIL_BYTES);
                }
            }
        }
    }

    tail
}

fn own_record(folder: &Path, spawned_at: i64) -> Option<ScanRunRecord> {
    let record = read_run(folder)?;
    let started = epoch_of_timestamp(&record.started_at)?;

    (record.started_by == "app" && started >= spawned_at - START_SLACK_SECONDS).then_some(record)
}

fn now_epoch() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs() as i64)
        .unwrap_or(0)
}

#[allow(clippy::too_many_arguments, dead_code)]
pub fn run_with(
    runs: &ScanRuns,
    label: &str,
    folder: &Path,
    runner: &ToolRunner,
    command: &str,
    describe: Describe,
    sense: &[String],
    modules: Option<&[String]>,
    confirm_above: Option<f64>,
    prepare: impl FnOnce(),
) -> ScanRun {
    run_with_suites(
        runs,
        label,
        folder,
        runner,
        command,
        describe,
        sense,
        modules,
        None,
        confirm_above,
        prepare,
    )
}

#[allow(clippy::too_many_arguments)]
pub fn run_with_suites(
    runs: &ScanRuns,
    label: &str,
    folder: &Path,
    runner: &ToolRunner,
    command: &str,
    describe: Describe,
    sense: &[String],
    modules: Option<&[String]>,
    suites: Option<&BTreeMap<String, Vec<String>>>,
    confirm_above: Option<f64>,
    prepare: impl FnOnce(),
) -> ScanRun {
    let suites = suites.filter(|plan| !plan.is_empty());

    if let Some(plan) = suites {
        if let Err(reason) = check_suites(plan) {
            return ScanRun::Refused { reason };
        }
    }

    if let Some(ids) = modules {
        if let Err(reason) = check_modules(ids) {
            return ScanRun::Refused { reason };
        }
    }

    if let Err(fault) = runner.check_all() {
        return ScanRun::Gaps {
            gaps: vec![fault_gap(&fault, ticked(describe, sense))],
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

    let suites_path = suites.map(|_| suites_file(folder, label));

    if let (Some(path), Some(plan)) = (&suites_path, suites) {
        let written = serde_json::to_string(plan)
            .map_err(|error| error.to_string())
            .and_then(|text| {
                write_atomic(path, &text).map_err(|error| format!("{}: {error}", path.display()))
            });

        if let Err(reason) = written {
            if let Some(path) = &file {
                let _ = fs::remove_file(path);
            }

            runs.finish(label);

            return ScanRun::Refused { reason };
        }
    }

    let result = spawn_and_stream(
        runs,
        label,
        folder,
        runner,
        command,
        describe,
        sense,
        file.as_deref(),
        suites_path.as_deref(),
        confirm_above,
    );

    for path in [&file, &suites_path].into_iter().flatten() {
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
    sense: &[String],
    modules_file: Option<&Path>,
    suites_file: Option<&Path>,
    confirm_above: Option<f64>,
) -> ScanRun {
    let mut process = match runner.command(command) {
        Ok(process) => process,
        Err(fault) => return refusal(fault),
    };

    process
        .env(STARTED_BY, "app")
        .args(scan_args(folder, describe, sense))
        .args(
            modules_file
                .map(|path| vec!["--modules".to_string(), path.display().to_string()])
                .unwrap_or_default(),
        )
        .args(
            suites_file
                .map(|path| vec!["--suites".to_string(), path.display().to_string()])
                .unwrap_or_default(),
        )
        .args(
            confirm_above
                .filter(|_| describe != Describe::Off)
                .map(|usd| vec!["--confirm-above".to_string(), usd.to_string()])
                .unwrap_or_default(),
        )
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());

    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;

        process.process_group(0);
    }

    let spawned_at = now_epoch();
    let mut child = match process.spawn() {
        Ok(child) => child,
        Err(_) => {
            return ScanRun::CommandMissing {
                hint: missing_hint(),
            }
        }
    };

    runs.started(label, child.id());

    let stderr = child.stderr.take();

    let (captured, status) = std::thread::scope(|scope| {
        let collected = scope.spawn(move || stderr.map(read_tail).unwrap_or_default());

        let status = child.wait();

        (collected.join().unwrap_or_default(), status)
    });

    let stopped = runs.lock().get(label).is_some_and(|handle| handle.stopped);
    let exit = status.ok().and_then(|status| status.code());

    let own = own_record(folder, spawned_at);
    let stderr_text = if own.is_some() {
        String::new()
    } else {
        bound_stderr(&captured)
    };
    let owner = if exit == Some(REFUSED_EXIT) {
        live_run(folder)
    } else {
        None
    };

    result_for(
        exit,
        stopped,
        stderr_text,
        own.as_ref(),
        owner.as_ref(),
        folder,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::Write;
    use std::path::PathBuf;
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
        sense: &[String],
    ) -> ScanRun {
        let tools = TempDir::new().unwrap();
        let runner = working_runner(tools.path());

        run_with(
            runs,
            "w-1",
            folder,
            &runner,
            &command.display().to_string(),
            describe,
            sense,
            None,
            None,
            || {},
        )
    }

    fn captured(dir: &Path) -> Vec<String> {
        fs::read_to_string(dir.join("capture.txt"))
            .unwrap_or_default()
            .lines()
            .map(str::to_string)
            .collect()
    }

    fn wait_for(path: &Path) {
        for _ in 0..600 {
            if path.exists() {
                return;
            }

            std::thread::sleep(Duration::from_millis(50));
        }

        panic!("{} never appeared", path.display());
    }

    #[test]
    fn the_result_serialises_to_the_webview_contract() {
        let json = |run: &ScanRun| serde_json::to_value(run).unwrap();

        assert_eq!(
            json(&ScanRun::Finished { exit_code: 1 }),
            serde_json::json!({"status": "finished", "exitCode": 1})
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
        let command = fake_command(
            dir.path(),
            r#"echo '{"event":"summary","log":"20261102T123456789Z-scan"}'"#,
        );
        let shell = dir.path().join("fake-shell");

        fs::write(
            &shell,
            "#!/bin/sh\nprintf '\\033]1337;RemoteHost=ken@host\\007shell=zsh\\n'\nshift\nexec /bin/sh -c \"$@\"\n",
        )
        .unwrap();
        fs::set_permissions(&shell, fs::Permissions::from_mode(0o755)).unwrap();

        let runner = runner_with(&shell, Duration::from_secs(10), Duration::from_secs(30), 4);
        let runs = ScanRuns::default();
        let result = run_with(
            &runs,
            "w-1",
            dir.path(),
            &runner,
            &command.display().to_string(),
            Describe::Off,
            &[],
            None,
            None,
            || {},
        );

        assert_eq!(result, ScanRun::Finished { exit_code: 0 });
    }

    #[cfg(unix)]
    #[test]
    fn exit_one_is_finished_and_nothing_is_forwarded() {
        let dir = TempDir::new().unwrap();
        let command = fake_command(
            dir.path(),
            r#"echo '{"event":"phase"}'; echo '{"event":"summary"}'; exit 1"#,
        );
        let result = collect(
            &ScanRuns::default(),
            dir.path(),
            &command,
            Describe::Off,
            &[],
        );

        assert_eq!(result, ScanRun::Finished { exit_code: 1 });
    }

    #[cfg(unix)]
    #[test]
    fn the_flags_reach_the_command_after_the_folder() {
        let dir = TempDir::new().unwrap();
        let command = fake_command(
            dir.path(),
            &format!(r#"echo "$@" > {}/capture.txt"#, dir.path().display()),
        );
        collect(
            &ScanRuns::default(),
            dir.path(),
            &command,
            Describe::Stale,
            &names(&["a"]),
        );

        assert_eq!(
            captured(dir.path()),
            vec![format!(
                "scan {} --json --describe --sense a",
                dir.path().display()
            )]
        );
    }

    #[cfg(unix)]
    fn collect_scoped(folder: &Path, command: &Path, modules: &[String]) -> ScanRun {
        collect_scoped_describing(folder, command, modules, Describe::Stale)
    }

    #[cfg(unix)]
    fn collect_scoped_describing(
        folder: &Path,
        command: &Path,
        modules: &[String],
        describe: Describe,
    ) -> ScanRun {
        let tools = TempDir::new().unwrap();
        let runner = working_runner(tools.path());

        run_with(
            &ScanRuns::default(),
            "w-1",
            folder,
            &runner,
            &command.display().to_string(),
            describe,
            &[],
            Some(modules),
            None,
            || {},
        )
    }

    #[cfg(unix)]
    #[test]
    fn a_describe_all_run_passes_describe_all_with_the_modules() {
        let dir = TempDir::new().unwrap();
        let command = fake_command(
            dir.path(),
            &format!(r#"echo "$@" > {}/capture.txt"#, dir.path().display()),
        );

        collect_scoped_describing(dir.path(), &command, &names(&["a.py"]), Describe::All);

        let file = dir.path().join(".recognizer/cache/scan-modules-w-1.json");

        assert_eq!(
            captured(dir.path()),
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
            &format!(
                r#"for last; do :; done; echo "$@" > {cap}/capture.txt; cat "$last" >> {cap}/capture.txt; echo >> {cap}/capture.txt; echo '{{"event":"summary","commit":"c","phases":[{{"phase":"describe","entries":[{{}}]}}],"log":null}}'"#,
                cap = dir.path().display()
            ),
        );
        let result = collect_scoped(dir.path(), &command, &names(&["a.py", "b/c.py"]));
        let lines: Vec<String> = captured(dir.path())
            .into_iter()
            .filter(|line| !line.is_empty())
            .collect();

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
    fn collect_suited(
        folder: &Path,
        command: &Path,
        suites: &BTreeMap<String, Vec<String>>,
    ) -> ScanRun {
        let tools = TempDir::new().unwrap();
        let runner = working_runner(tools.path());

        run_with_suites(
            &ScanRuns::default(),
            "w-1",
            folder,
            &runner,
            &command.display().to_string(),
            Describe::Stale,
            &["crap".to_string()],
            None,
            Some(suites),
            None,
            || {},
        )
    }

    #[cfg(unix)]
    #[test]
    fn an_empty_suites_map_adds_no_flag_and_writes_no_file() {
        let dir = TempDir::new().unwrap();
        let command = fake_command(
            dir.path(),
            &format!(
                r#"echo "$@" > {cap}/capture.txt; echo '{{"event":"summary","commit":"c","phases":[{{"phase":"describe","entries":[{{}}]}}],"log":null}}'"#,
                cap = dir.path().display()
            ),
        );
        let result = collect_suited(dir.path(), &command, &BTreeMap::new());
        let lines: Vec<String> = captured(dir.path())
            .into_iter()
            .filter(|line| !line.is_empty())
            .collect();

        assert!(matches!(result, ScanRun::Finished { exit_code: 0, .. }));
        assert_eq!(
            lines,
            vec![format!(
                "scan {} --json --describe --sense crap",
                dir.path().display()
            )]
        );
        assert!(!dir
            .path()
            .join(".recognizer/cache/scan-suites-w-1.json")
            .exists());
    }

    #[cfg(unix)]
    #[test]
    fn the_suites_reach_the_command_as_a_file_that_is_removed_after_the_run() {
        let dir = TempDir::new().unwrap();
        let command = fake_command(
            dir.path(),
            &format!(
                r#"for last; do :; done; echo "$@" > {cap}/capture.txt; cat "$last" >> {cap}/capture.txt; echo >> {cap}/capture.txt; echo '{{"event":"summary","commit":"c","phases":[{{"phase":"describe","entries":[{{}}]}}],"log":null}}'"#,
                cap = dir.path().display()
            ),
        );
        let suites = BTreeMap::from([(
            "crap".to_string(),
            vec!["unit".to_string(), "web".to_string()],
        )]);
        let result = collect_suited(dir.path(), &command, &suites);
        let lines: Vec<String> = captured(dir.path())
            .into_iter()
            .filter(|line| !line.is_empty())
            .collect();
        let file = dir.path().join(".recognizer/cache/scan-suites-w-1.json");

        assert!(matches!(result, ScanRun::Finished { exit_code: 0, .. }));
        assert_eq!(
            lines,
            vec![
                format!(
                    "scan {} --json --describe --sense crap --suites {}",
                    dir.path().display(),
                    file.display()
                ),
                r#"{"crap":["unit","web"]}"#.to_string(),
            ]
        );
        assert!(!file.exists());
        assert!(!dir
            .path()
            .join(".recognizer/cache/scan-suites-w-1.json.tmp")
            .exists());
    }

    #[cfg(unix)]
    #[test]
    fn a_bad_suite_plan_is_refused_before_anything_is_written() {
        let dir = TempDir::new().unwrap();
        let ran = dir.path().join("ran");
        let command = fake_command(dir.path(), &format!("touch {}", ran.display()));

        for bad in [
            BTreeMap::from([("crap".to_string(), vec![])]),
            BTreeMap::from([("crap".to_string(), vec![String::new()])]),
            BTreeMap::from([("$(x)".to_string(), vec!["unit".to_string()])]),
        ] {
            let result = collect_suited(dir.path(), &command, &bad);

            assert!(matches!(result, ScanRun::Refused { .. }));
            assert!(!ran.exists());
        }

        assert!(!dir.path().join(".recognizer").exists());
    }

    #[cfg(unix)]
    #[test]
    fn a_failed_scoped_run_removes_the_module_file() {
        let dir = TempDir::new().unwrap();
        let command = fake_command(dir.path(), "exit 3");
        collect_scoped(dir.path(), &command, &names(&["a.py"]));

        assert!(!dir
            .path()
            .join(".recognizer/cache/scan-modules-w-1.json")
            .exists());
    }

    #[cfg(unix)]
    #[test]
    fn an_empty_list_an_empty_id_or_a_nul_is_refused_before_anything_is_written() {
        let dir = TempDir::new().unwrap();
        let ran = dir.path().join("ran");
        let command = fake_command(dir.path(), &format!("touch {}", ran.display()));

        for bad in [names(&[]), names(&["a.py", ""]), vec!["a\0b".to_string()]] {
            let result = collect_scoped(dir.path(), &command, &bad);

            assert!(matches!(result, ScanRun::Refused { .. }));
            assert!(!ran.exists());
        }

        assert!(!dir.path().join(".recognizer").exists());
    }

    #[cfg(unix)]
    #[test]
    fn exit_two_is_failed_with_stderr_and_127_is_missing() {
        let dir = TempDir::new().unwrap();
        let command = fake_command(dir.path(), "echo bad flag >&2; exit 2");
        let result = collect(
            &ScanRuns::default(),
            dir.path(),
            &command,
            Describe::Off,
            &[],
        );

        assert_eq!(
            result,
            ScanRun::Failed {
                exit_code: 2,
                stderr: "bad flag".into()
            }
        );

        let missing = collect(
            &ScanRuns::default(),
            dir.path(),
            Path::new("/nonexistent/recognizer"),
            Describe::Off,
            &[],
        );

        assert!(matches!(missing, ScanRun::CommandMissing { .. }));
    }

    #[cfg(unix)]
    #[test]
    fn a_second_run_is_refused_and_stop_kills_the_first() {
        let dir = TempDir::new().unwrap();
        let started = dir.path().join("started");
        let command = fake_command(
            dir.path(),
            &format!("touch {}; sleep 30", started.display()),
        );
        let runs = Arc::new(ScanRuns::default());
        let runner = Arc::new(working_runner(dir.path()));
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
                    None,
                    None,
                    || {},
                )
            })
        };

        wait_for(&started);

        let second = collect(&runs, dir.path(), &command, Describe::Off, &[]);

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

    fn running_record(folder: &Path, run_id: &str) {
        write_run_with(
            folder,
            &run_text(
                std::process::id(),
                None,
                "running",
                "app",
                run_id,
                &now_timestamp(),
            ),
        );
    }

    fn answer_file(folder: &Path) -> PathBuf {
        folder.join(MARKER_ANSWER)
    }

    #[test]
    fn answer_describe_writes_one_answer_for_the_live_run() {
        let dir = TempDir::new().unwrap();
        let valid = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../schema/scan-answer-examples/valid/describe-no.json");
        let example: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(valid).unwrap()).unwrap();
        let run_id = example["run_id"].as_str().unwrap().to_string();

        running_record(dir.path(), &run_id);

        assert!(answer_describe(dir.path(), false).is_ok());

        let written: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(answer_file(dir.path())).unwrap()).unwrap();

        assert_eq!(written, example);
        assert!(answer_describe(dir.path(), true).is_err());
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(
                &fs::read_to_string(answer_file(dir.path())).unwrap()
            )
            .unwrap(),
            example
        );
    }

    #[test]
    fn answer_describe_writes_the_answer_for_a_new_run_over_a_stale_one() {
        let dir = TempDir::new().unwrap();

        running_record(dir.path(), "run-2");
        fs::write(
            answer_file(dir.path()),
            r#"{"version":1,"run_id":"run-1","describe":true}"#,
        )
        .unwrap();

        assert!(answer_describe(dir.path(), false).is_ok());

        let written: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(answer_file(dir.path())).unwrap()).unwrap();

        assert_eq!(written["run_id"], "run-2");
        assert_eq!(written["describe"], false);
    }

    #[test]
    fn answer_describe_refuses_without_a_live_running_record() {
        let dir = TempDir::new().unwrap();

        assert_eq!(
            answer_describe(dir.path(), true),
            Err("no scan is waiting for an answer".to_string())
        );

        write_run(dir.path(), std::process::id(), "finished", "app");

        assert_eq!(
            answer_describe(dir.path(), true),
            Err("no scan is waiting for an answer".to_string())
        );

        write_run(dir.path(), std::process::id(), "checking", "app");

        assert_eq!(
            answer_describe(dir.path(), true),
            Err("no scan is waiting for an answer".to_string())
        );
        assert!(!answer_file(dir.path()).exists());
    }

    #[cfg(unix)]
    #[test]
    fn the_child_always_starts_with_stdin_null() {
        let dir = TempDir::new().unwrap();
        let out = dir.path().join("stdin.txt");
        let command = fake_command(
            dir.path(),
            &format!(
                "if read -r line; then echo open > {out}; else echo closed > {out}; fi",
                out = out.display()
            ),
        );
        let tools = TempDir::new().unwrap();
        let runner = working_runner(tools.path());

        run_with(
            &ScanRuns::default(),
            "w-1",
            dir.path(),
            &runner,
            &command.display().to_string(),
            Describe::Stale,
            &[],
            None,
            Some(5.0),
            || {},
        );

        assert_eq!(fs::read_to_string(out).unwrap().trim(), "closed");
    }

    #[cfg(unix)]
    #[test]
    fn stopping_while_waiting_for_an_answer_ends_the_scan() {
        let dir = TempDir::new().unwrap();
        let waiting = dir.path().join("waiting");
        let command = fake_command(
            dir.path(),
            &format!(
                "touch {waiting}; while [ ! -f {answer} ]; do sleep 0.1; done",
                waiting = waiting.display(),
                answer = answer_file(dir.path()).display()
            ),
        );
        let runs = Arc::new(ScanRuns::default());
        let runner = Arc::new(working_runner(dir.path()));
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
                    None,
                    Some(5.0),
                    || {},
                )
            })
        };

        wait_for(&waiting);

        runs.stop("w-1");

        assert_eq!(worker.join().unwrap(), ScanRun::Stopped);
        assert!(answer_describe(dir.path(), true).is_err());
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

    #[test]
    fn a_stopped_run_stays_stopped_and_only_an_exit_of_zero_or_one_is_finished() {
        assert_eq!(
            result_for(Some(0), true, String::new(), None, None, Path::new("/r")),
            ScanRun::Stopped
        );
        assert!(matches!(
            result_for(Some(1), false, String::new(), None, None, Path::new("/r")),
            ScanRun::Finished { exit_code: 1, .. }
        ));
        assert!(matches!(
            result_for(Some(2), false, String::new(), None, None, Path::new("/r")),
            ScanRun::Failed { .. }
        ));
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
            None,
            None,
            || panic!("prepare must not run"),
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
        let ran = if phase == "finished" {
            r#"["extract"]"#
        } else {
            "null"
        };

        format!(
            r#"{{"version":5,"run_id":"{run_id}","pid":{pid},"pgid":{pgid},"started_at":"{started_at}","started_by":"{started_by}","repository":"/work/shop","sensors":["crap"],"describe":true,"suites":{{}},"phase":"{phase}","ended_at":null,"exit":null,"gaps":[],"failure":null,"commit":null,"ran":{ran}}}"#
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

        assert_eq!(valid.len(), 9);
        assert_eq!(invalid.len(), 15);
        assert!(valid.iter().all(|text| parse_run(text).is_some()));
        assert!(invalid.iter().all(|text| parse_run(text).is_none()));

        let mut phases: Vec<String> = valid
            .iter()
            .map(|text| parse_run(text).unwrap().phase)
            .collect();

        phases.sort();

        assert_eq!(
            phases,
            vec![
                "checking", "failed", "failed", "failed", "finished", "finished", "refused",
                "running", "stopped"
            ]
        );
    }

    fn failed_with_code(code: &str) -> String {
        let text = examples("valid")
            .into_iter()
            .find(|text| text.contains("the test run timed out"))
            .unwrap();

        text.replace("\"code\": null", &format!("\"code\": {code}"))
    }

    #[test]
    fn a_failure_code_of_any_non_empty_string_is_accepted_and_an_empty_one_rejected() {
        let custom = parse_run(&failed_with_code("\"custom-code\"")).unwrap();

        assert_eq!(custom.failure.unwrap().code.as_deref(), Some("custom-code"));
        assert!(parse_run(&failed_with_code("\"\"")).is_none());
    }

    #[cfg(unix)]
    #[test]
    fn stopping_kills_a_group_that_ignores_term_after_the_backstop() {
        use std::os::unix::process::CommandExt;

        let runs = ScanRuns::with_backstop(Duration::from_millis(300));
        let mut child = Command::new("/bin/sh")
            .args(["-c", "trap '' TERM; while :; do sleep 1; done"])
            .process_group(0)
            .spawn()
            .unwrap();

        runs.begin("w-1").unwrap();
        runs.started("w-1", child.id());
        std::thread::sleep(Duration::from_millis(100));
        runs.stop("w-1");
        std::thread::sleep(Duration::from_millis(100));

        assert!(child.try_wait().unwrap().is_none());

        let deadline = std::time::Instant::now() + Duration::from_secs(10);

        while child.try_wait().unwrap().is_none() {
            assert!(
                std::time::Instant::now() < deadline,
                "the group outlived the backstop"
            );
            std::thread::sleep(Duration::from_millis(50));
        }
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

    #[test]
    fn the_poll_runs_every_quarter_second_while_a_scan_is_active_and_every_second_otherwise() {
        let dir = TempDir::new().unwrap();
        let mut seen = RunSeen::default();

        assert_eq!(poll_interval(&seen), Duration::from_secs(1));

        write_run(dir.path(), std::process::id(), "checking", "cli");
        run_tick(Some(dir.path()), &mut seen);

        assert_eq!(poll_interval(&seen), Duration::from_millis(250));

        write_run(dir.path(), std::process::id(), "running", "cli");
        run_tick(Some(dir.path()), &mut seen);

        assert_eq!(poll_interval(&seen), Duration::from_millis(250));

        write_run(dir.path(), std::process::id(), "finished", "cli");
        run_tick(Some(dir.path()), &mut seen);

        assert_eq!(poll_interval(&seen), Duration::from_secs(1));
    }

    #[test]
    fn a_terminal_record_follows_the_lines_that_ended_the_run() {
        let dir = TempDir::new().unwrap();
        let mut seen = RunSeen::default();

        write_run(dir.path(), std::process::id(), "running", "cli");
        run_tick(Some(dir.path()), &mut seen);
        append_progress(dir.path(), "{\"event\":\"summary\"}\n");
        write_run(dir.path(), std::process::id(), "finished", "cli");

        let emitted = run_tick(Some(dir.path()), &mut seen);

        assert_eq!(emitted.len(), 2);
        assert_eq!(
            emitted[0],
            RunEmission::Line("{\"event\":\"summary\"}".to_string())
        );
        assert!(matches!(&emitted[1], RunEmission::Run(Some(run)) if run.phase == "finished"));
    }

    #[test]
    fn an_active_record_precedes_its_lines() {
        let dir = TempDir::new().unwrap();
        let mut seen = RunSeen::default();

        write_run(dir.path(), std::process::id(), "checking", "cli");
        append_progress(dir.path(), "{\"event\":\"preflight\"}\n");

        let emitted = run_tick(Some(dir.path()), &mut seen);

        assert!(matches!(&emitted[0], RunEmission::Run(Some(_))));
        assert_eq!(
            emitted[1],
            RunEmission::Line("{\"event\":\"preflight\"}".to_string())
        );
    }

    #[test]
    fn the_post_exit_tick_emits_the_terminal_record_and_trailing_lines_once() {
        let dir = TempDir::new().unwrap();
        let runs = ScanRuns::default();

        write_run(dir.path(), std::process::id(), "running", "app");
        append_progress(dir.path(), "{\"event\":\"one\"}\n");

        let polled = runs.tick("w-1", Some(dir.path()));

        assert_eq!(polled.len(), 2);

        append_progress(dir.path(), "{\"event\":\"summary\"}\n");
        write_run(dir.path(), std::process::id(), "finished", "app");

        let after_exit = runs.tick("w-1", Some(dir.path()));
        let polled_again = runs.tick("w-1", Some(dir.path()));

        assert_eq!(after_exit.len(), 2);
        assert_eq!(
            after_exit[0],
            RunEmission::Line("{\"event\":\"summary\"}".to_string())
        );
        assert!(matches!(&after_exit[1], RunEmission::Run(Some(run)) if run.phase == "finished"));
        assert!(polled_again.is_empty());
        assert_eq!(runs.interval("w-1"), Duration::from_secs(1));
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
            None,
            None,
            || *prepared.lock().unwrap() = true,
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
    fn exit_code_three_is_a_refusal_naming_the_live_owner() {
        let folder = Path::new("/work/shop");
        let owner = parse_run(&run_text(
            4242,
            Some(4242),
            "running",
            "cli",
            "run-1",
            "2026-11-12T09:00:00.000Z",
        ))
        .unwrap();

        assert_eq!(
            result_for(Some(3), false, String::new(), None, Some(&owner), folder),
            ScanRun::Refused {
                reason: refusal_text(&owner, folder)
            }
        );
        assert_eq!(
            result_for(Some(3), false, String::new(), None, None, folder),
            ScanRun::Refused {
                reason: "a scan is already running on /work/shop".to_string()
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

    fn record_writer(
        dir: &Path,
        phase: &str,
        exit: i32,
        started_by: &str,
        started_at: &str,
        gaps: &str,
    ) -> String {
        let record = format!(
            r#"{{"version":5,"run_id":"fake-run","pid":4242,"pgid":4242,"started_at":"{started_at}","started_by":"{started_by}","repository":"/work/shop","sensors":["crap"],"describe":false,"suites":{{}},"phase":"{phase}","ended_at":"{started_at}","exit":{exit},"gaps":{gaps},"failure":null,"commit":"abc","ran":["extract"]}}"#
        );
        let source = dir.join("fake-record.json");

        fs::write(&source, record).unwrap();

        format!(
            "mkdir -p {cache}\ncp {source} {cache}/scan-running.json",
            cache = dir.join(MODULES_DIR).display(),
            source = source.display()
        )
    }

    const TWO_GAPS: &str = r#"[{"id":"a","line":"coverage is not installed","needs":["crap"]},{"id":"b","line":"pytest is not installed","needs":["crap"]}]"#;

    #[cfg(unix)]
    #[test]
    fn a_finished_record_and_a_silent_stdout_give_finished_with_the_exit_code() {
        let dir = TempDir::new().unwrap();
        let writer = record_writer(dir.path(), "finished", 0, "app", &now_timestamp(), "[]");
        let command = fake_command(dir.path(), &writer);
        let result = collect(
            &ScanRuns::default(),
            dir.path(),
            &command,
            Describe::Off,
            &names(&["crap"]),
        );

        assert_eq!(result, ScanRun::Finished { exit_code: 0 });
    }

    #[cfg(unix)]
    #[test]
    fn a_record_of_its_own_wins_over_differing_stderr() {
        let dir = TempDir::new().unwrap();
        let writer = record_writer(dir.path(), "failed", 1, "app", &now_timestamp(), "[]");
        let command = fake_command(dir.path(), &format!("{writer}\necho noise >&2; exit 2"));
        let result = collect(
            &ScanRuns::default(),
            dir.path(),
            &command,
            Describe::Off,
            &[],
        );

        assert_eq!(
            result,
            ScanRun::Failed {
                exit_code: 2,
                stderr: String::new()
            }
        );
    }

    #[cfg(unix)]
    fn stderr_of(dir: &Path, body: &str) -> String {
        let command = fake_command(dir, body);

        match collect(&ScanRuns::default(), dir, &command, Describe::Off, &[]) {
            ScanRun::Failed { stderr, .. } => stderr,
            other => panic!("expected a failure, got {other:?}"),
        }
    }

    #[cfg(unix)]
    #[test]
    fn a_long_stderr_without_a_record_keeps_its_last_8192_characters() {
        let dir = TempDir::new().unwrap();
        let long = stderr_of(
            dir.path(),
            "printf 'x'; head -c 8192 /dev/zero | tr '\\0' 'y' >&2; exit 2",
        );

        assert_eq!(long, "y".repeat(8192));

        let boundary = stderr_of(
            dir.path(),
            "head -c 8192 /dev/zero | tr '\\0' 'z' >&2; exit 2",
        );

        assert_eq!(boundary, "z".repeat(8192));

        let wider = stderr_of(
            dir.path(),
            "head -c 8193 /dev/zero | tr '\\0' 'w' >&2; exit 2",
        );

        assert_eq!(wider, "w".repeat(8192));
    }

    #[test]
    fn a_byte_cut_inside_a_multi_byte_character_keeps_whole_characters() {
        let text = "é".repeat(20000);
        let bytes = text.as_bytes();
        let tail = &bytes[bytes.len() - STDERR_TAIL_BYTES - 1..];
        let kept = bound_stderr(tail);

        assert_eq!(kept.chars().count(), STDERR_CHARS);
        assert!(kept.chars().all(|character| character == 'é'));
    }

    #[test]
    fn the_stderr_reader_keeps_only_the_tail_it_may_hold() {
        let bytes: Vec<u8> = (0..100_000u32).map(|at| (at % 251) as u8).collect();
        let tail = read_tail(bytes.as_slice());

        assert_eq!(tail.len(), STDERR_TAIL_BYTES);
        assert_eq!(tail, bytes[bytes.len() - STDERR_TAIL_BYTES..]);
    }

    #[cfg(unix)]
    #[test]
    fn a_printed_summary_and_preflight_with_no_record_are_not_a_source_of_gaps() {
        let dir = TempDir::new().unwrap();
        let command = fake_command(
            dir.path(),
            r#"echo '{"event":"preflight","state":"gaps","gaps":[{"id":"a","line":"l","needs":["crap"]}]}'; echo '{"event":"summary","exit":0,"commit":null,"phases":[],"log":null}'"#,
        );
        let result = collect(
            &ScanRuns::default(),
            dir.path(),
            &command,
            Describe::Off,
            &names(&["crap"]),
        );

        assert_eq!(result, ScanRun::Finished { exit_code: 0 });
    }

    #[cfg(unix)]
    #[test]
    fn exit_four_with_a_refused_record_is_gaps_and_without_one_is_failed() {
        let dir = TempDir::new().unwrap();
        let runs = ScanRuns::default();
        let sense = names(&["crap"]);
        let writer = record_writer(dir.path(), "refused", 4, "app", &now_timestamp(), TWO_GAPS);
        let with = fake_command(dir.path(), &format!("{writer}\nexit 4"));
        let result = collect(&runs, dir.path(), &with, Describe::Off, &sense);

        match result {
            ScanRun::Gaps { gaps } => {
                assert_eq!(gaps.len(), 2);
                assert_eq!(gaps[0].id, "a");
                assert_eq!(gaps[1].id, "b");
            }
            other => panic!("expected Gaps, got {other:?}"),
        }

        let bare = TempDir::new().unwrap();
        let without = fake_command(bare.path(), "echo oops >&2\nexit 4");
        let result = collect(&runs, bare.path(), &without, Describe::Off, &sense);

        assert!(matches!(result, ScanRun::Failed { exit_code: 4, .. }));
    }

    #[cfg(unix)]
    #[test]
    fn exit_four_with_only_a_stale_or_foreign_record_is_failed() {
        let stale = timestamp_of_epoch(now_epoch() - 60);

        for (started_by, started_at) in [("app", stale), ("cli", now_timestamp())] {
            let dir = TempDir::new().unwrap();
            let writer = record_writer(dir.path(), "refused", 4, started_by, &started_at, TWO_GAPS);
            let command = fake_command(dir.path(), &format!("echo oops >&2\n{writer}\nexit 4"));
            let result = collect(
                &ScanRuns::default(),
                dir.path(),
                &command,
                Describe::Off,
                &names(&["crap"]),
            );

            assert!(
                matches!(result, ScanRun::Failed { exit_code: 4, .. }),
                "{started_by}: {result:?}"
            );
        }
    }
}
