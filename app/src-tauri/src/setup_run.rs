use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;

use crate::repository::{clean_output, RECOGNIZER_COMMAND};
use crate::scan_run::{appended_lines, kill_group, live_run, read_run, refusal_text};
use crate::tool_runner::{Captured, ToolFault, ToolRunner};

const FEED_POLL: Duration = Duration::from_millis(250);
const STDERR_CHARS: usize = 2000;
const LIMIT_TEXT: &str = "usage limit";
const SIGNED_OUT_TEXT: &str = "not logged in";
const SIGNED_OUT_REASON: &str =
    "Claude Code is not signed in. Open a terminal, run claude and sign in, then try again.";

const ALLOWED_TOOLS: [&str; 9] = [
    "Read",
    "Glob",
    "Grep",
    "Bash(recognizer help:*)",
    "Bash(recognizer plugins:*)",
    "Bash(recognizer doctor:*)",
    "Bash(recognizer scan --extract)",
    "Bash(recognizer uses:*)",
    "Bash(recognizer used-by:*)",
];

#[derive(Default)]
struct Live {
    pid: Option<u32>,
    stopped: bool,
}

#[derive(Default)]
pub struct SetupRuns {
    live: Mutex<HashMap<String, Live>>,
    reads: Mutex<HashMap<String, Live>>,
    next_read: std::sync::atomic::AtomicUsize,
}

impl SetupRuns {
    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, Live>> {
        self.live.lock().unwrap_or_else(|error| error.into_inner())
    }

    pub fn begin(&self, label: &str) -> Result<(), String> {
        let mut live = self.lock();

        if live.contains_key(label) {
            return Err("a setup check or apply is already running".to_string());
        }

        live.insert(label.to_string(), Live::default());

        Ok(())
    }

    fn started(&self, label: &str, pid: u32) {
        let mut live = self.lock();

        if let Some(run) = live.get_mut(label) {
            run.pid = Some(pid);

            if run.stopped {
                kill_group(pid);
            }
        }
    }

    fn lock_reads(&self) -> std::sync::MutexGuard<'_, HashMap<String, Live>> {
        self.reads.lock().unwrap_or_else(|error| error.into_inner())
    }

    pub fn begin_read(&self, label: &str) -> String {
        let number = self
            .next_read
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let key = format!("{label}#read-{number}");

        self.lock_reads().insert(key.clone(), Live::default());

        key
    }

    pub fn started_read(&self, key: &str, pid: u32) {
        let mut reads = self.lock_reads();

        if let Some(read) = reads.get_mut(key) {
            read.pid = Some(pid);

            if read.stopped {
                kill_group(pid);
            }
        }
    }

    pub fn finish_read(&self, key: &str) {
        self.lock_reads().remove(key);
    }

    pub fn stop(&self, label: &str) {
        let prefix = format!("{label}#read-");

        for (key, read) in self.lock_reads().iter_mut() {
            if key.starts_with(&prefix) {
                read.stopped = true;

                if let Some(pid) = read.pid {
                    kill_group(pid);
                }
            }
        }

        let mut live = self.lock();

        if let Some(run) = live.get_mut(label) {
            run.stopped = true;

            if let Some(pid) = run.pid {
                kill_group(pid);
            }
        }
    }

    pub fn stop_all(&self) {
        let mut labels: Vec<String> = self.lock().keys().cloned().collect();

        labels.extend(self.lock_reads().keys().map(|key| {
            key.split_once("#read-")
                .map_or(key.as_str(), |(label, _)| label)
                .to_string()
        }));

        for label in labels {
            self.stop(&label);
        }
    }

    pub fn stopped(&self, label: &str) -> bool {
        self.lock().get(label).is_some_and(|run| run.stopped)
    }

    fn finish(&self, label: &str) -> bool {
        self.lock().remove(label).is_some_and(|run| run.stopped)
    }

    pub fn running(&self, label: &str) -> bool {
        self.lock().contains_key(label)
    }

    pub fn running_count(&self) -> usize {
        self.lock().len()
    }
}

pub fn claude_args(model: &str, schema: &str) -> Vec<String> {
    let mut args: Vec<String> = [
        "-p",
        "--model",
        model,
        "--output-format",
        "stream-json",
        "--verbose",
        "--json-schema",
        schema,
        "--no-session-persistence",
        "--permission-mode",
        "dontAsk",
        "--allowedTools",
    ]
    .iter()
    .map(|part| part.to_string())
    .collect();

    args.extend(ALLOWED_TOOLS.iter().map(|rule| rule.to_string()));

    args.extend(
        [
            "--setting-sources",
            "",
            "--strict-mcp-config",
            "--mcp-config",
            "{\"mcpServers\":{}}",
            "--disable-slash-commands",
        ]
        .iter()
        .map(|part| part.to_string()),
    );

    args
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResultFacts {
    pub structured_output: Option<Value>,
    pub total_cost_usd: Option<f64>,
    pub duration_ms: Option<u64>,
    pub is_error: bool,
    pub subtype: Option<String>,
    pub text: Option<String>,
    pub permission_denials: usize,
}

fn target_of(input: &Value) -> String {
    for key in ["file_path", "path", "pattern", "command"] {
        if let Some(text) = input.get(key).and_then(Value::as_str) {
            return text.to_string();
        }
    }

    String::new()
}

pub fn parse_line(line: &str) -> (Vec<String>, Option<ResultFacts>) {
    let Ok(value) = serde_json::from_str::<Value>(line) else {
        return (Vec::new(), None);
    };

    match value.get("type").and_then(Value::as_str) {
        Some("assistant") => {
            let progress = value
                .pointer("/message/content")
                .and_then(Value::as_array)
                .map(|content| {
                    content
                        .iter()
                        .filter(|item| item.get("type").and_then(Value::as_str) == Some("tool_use"))
                        .map(|item| {
                            let name = item.get("name").and_then(Value::as_str).unwrap_or("tool");
                            let target = item.get("input").map(target_of).unwrap_or_default();

                            if target.is_empty() {
                                name.to_string()
                            } else {
                                format!("{name} {target}")
                            }
                        })
                        .collect()
                })
                .unwrap_or_default();

            (progress, None)
        }
        Some("result") => (
            Vec::new(),
            Some(ResultFacts {
                structured_output: value
                    .get("structured_output")
                    .filter(|v| !v.is_null())
                    .cloned(),
                total_cost_usd: value.get("total_cost_usd").and_then(Value::as_f64),
                duration_ms: value.get("duration_ms").and_then(Value::as_u64),
                is_error: value
                    .get("is_error")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                subtype: value
                    .get("subtype")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                text: value
                    .get("result")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                permission_denials: value
                    .get("permission_denials")
                    .and_then(Value::as_array)
                    .map_or(0, Vec::len),
            }),
        ),
        _ => (Vec::new(), None),
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(
    tag = "status",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum SetupCheck {
    Proposal {
        output: Value,
        cost_usd: Option<f64>,
        duration_ms: Option<u64>,
        denials: usize,
    },
    Failed {
        reason: String,
        subtype: Option<String>,
        cost_usd: Option<f64>,
        duration_ms: Option<u64>,
    },
    Cancelled,
    Refused {
        reason: String,
    },
    Unavailable {
        reason: String,
    },
}

fn tail_chars(text: &str) -> String {
    let count = text.chars().count();

    text.chars()
        .skip(count.saturating_sub(STDERR_CHARS))
        .collect()
}

pub fn outcome_of(facts: Option<ResultFacts>, code: Option<i32>, stderr: &str) -> SetupCheck {
    match facts {
        Some(facts) => match facts.structured_output {
            Some(output) if !facts.is_error => SetupCheck::Proposal {
                output,
                cost_usd: facts.total_cost_usd,
                duration_ms: facts.duration_ms,
                denials: facts.permission_denials,
            },
            _ => SetupCheck::Failed {
                reason: match facts.text.filter(|text| !text.trim().is_empty()) {
                    Some(text) if text.to_lowercase().contains(SIGNED_OUT_TEXT) => {
                        SIGNED_OUT_REASON.to_string()
                    }
                    Some(text) => text,
                    None => "claude answered without a proposal".to_string(),
                },
                subtype: facts.subtype,
                cost_usd: facts.total_cost_usd,
                duration_ms: facts.duration_ms,
            },
        },
        None => {
            let detail = clean_output(stderr);
            let limited = detail.to_lowercase().contains(LIMIT_TEXT)
                || detail.to_lowercase().contains("rate limit");

            SetupCheck::Failed {
                reason: if limited {
                    format!("claude hit a usage or rate limit: {}", tail_chars(&detail))
                } else {
                    format!(
                        "claude exited {} without an answer: {}",
                        code.map_or("by signal".to_string(), |code| code.to_string()),
                        tail_chars(&detail)
                    )
                },
                subtype: None,
                cost_usd: None,
                duration_ms: None,
            }
        }
    }
}

#[allow(clippy::too_many_arguments)]
pub fn run_check(
    runs: &SetupRuns,
    label: &str,
    folder: &Path,
    runner: &ToolRunner,
    model: &str,
    prompt: &str,
    schema: &str,
    on_line: impl Fn(String),
) -> SetupCheck {
    if let Some(run) = live_run(folder) {
        return SetupCheck::Refused {
            reason: refusal_text(&run, folder),
        };
    }

    let mut process = match runner.external_command("claude") {
        Ok(process) => process,
        Err(fault) => {
            return SetupCheck::Unavailable {
                reason: fault.message(),
            }
        }
    };

    if let Err(reason) = runs.begin(label) {
        return SetupCheck::Refused { reason };
    }

    process
        .args(claude_args(model, schema))
        .current_dir(folder)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;

        process.process_group(0);
    }

    let mut child = match process.spawn() {
        Ok(child) => child,
        Err(error) => {
            runs.finish(label);

            return SetupCheck::Unavailable {
                reason: format!("claude could not start: {error}"),
            };
        }
    };

    runs.started(label, child.id());

    let stdin = child.stdin.take();
    let prompt = prompt.to_string();
    let writer = std::thread::spawn(move || {
        if let Some(mut stdin) = stdin {
            let _ = stdin.write_all(prompt.as_bytes());
        }
    });
    let stderr = child.stderr.take();
    let errors = std::thread::spawn(move || {
        let mut bytes = Vec::new();

        if let Some(mut stderr) = stderr {
            let _ = stderr.read_to_end(&mut bytes);
        }

        String::from_utf8_lossy(&bytes).into_owned()
    });

    let mut facts = None;

    if let Some(stdout) = child.stdout.take() {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            let (progress, result) = parse_line(&line);

            for entry in progress {
                on_line(entry);
            }

            if result.is_some() {
                facts = result;
            }
        }
    }

    let status = child.wait().ok();
    let _ = writer.join();
    let stderr = errors.join().unwrap_or_default();
    let stopped = runs.finish(label);

    if stopped {
        return SetupCheck::Cancelled;
    }

    outcome_of(facts, status.and_then(|status| status.code()), &stderr)
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub enum DoctorRead {
    Ok { report: Value },
    Unavailable { reason: String },
}

pub fn doctor_from(captured: Result<Captured, ToolFault>) -> DoctorRead {
    let captured = match captured {
        Ok(captured) => captured,
        Err(fault) => {
            return DoctorRead::Unavailable {
                reason: fault.message(),
            }
        }
    };

    if !matches!(captured.code, Some(0) | Some(1)) {
        let detail = captured.stderr.trim();

        return DoctorRead::Unavailable {
            reason: if detail.is_empty() {
                "recognizer doctor did not answer".to_string()
            } else {
                tail_chars(detail)
            },
        };
    }

    match serde_json::from_str::<Value>(&captured.stdout) {
        Ok(report) => DoctorRead::Ok { report },
        Err(_) => DoctorRead::Unavailable {
            reason: "recognizer doctor printed no JSON".to_string(),
        },
    }
}

fn capture_command(
    runner: &ToolRunner,
    mut process: Command,
    started: impl FnOnce(u32),
) -> Result<Captured, ToolFault> {
    process
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;

        process.process_group(0);
    }

    runner
        .limited(|| {
            let child = process.spawn()?;

            started(child.id());

            child.wait_with_output()
        })
        .map(|output| Captured {
            code: output.status.code(),
            stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        })
        .map_err(|_| ToolFault::Missing {
            tool: RECOGNIZER_COMMAND.to_string(),
        })
}

fn capture_recognizer(
    runner: &ToolRunner,
    folder: &Path,
    args: &[String],
    started: impl FnOnce(u32),
) -> Result<Captured, ToolFault> {
    runner.command(RECOGNIZER_COMMAND).and_then(|mut process| {
        process.args(args).current_dir(folder);

        capture_command(runner, process, started)
    })
}

fn words(parts: &[&str]) -> Vec<String> {
    parts.iter().map(|part| part.to_string()).collect()
}

fn read_doctor(runner: &ToolRunner, folder: &Path, started: impl FnOnce(u32)) -> DoctorRead {
    doctor_from(capture_recognizer(
        runner,
        folder,
        &words(&["doctor", "--json"]),
        started,
    ))
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub enum SurveyRead {
    Ok { survey: Value, doctor: DoctorRead },
    Unavailable { reason: String },
}

fn survey_of(
    runner: &ToolRunner,
    folder: &Path,
    started: impl FnOnce(u32),
) -> Result<Value, String> {
    let mut args = words(&["setup", "survey"]);

    args.push(folder.display().to_string());

    let captured =
        capture_recognizer(runner, folder, &args, started).map_err(|fault| fault.message())?;

    if captured.code != Some(0) {
        let detail = captured.stderr.trim();

        return Err(if detail.is_empty() {
            "recognizer setup survey did not answer".to_string()
        } else {
            tail_chars(detail)
        });
    }

    serde_json::from_str::<Value>(&captured.stdout)
        .map_err(|_| "recognizer setup survey printed no JSON".to_string())
}

fn step_line(step: &str, state: &str) -> String {
    serde_json::json!({ "event": "step", "step": step, "state": state }).to_string()
}

struct FeedRelay {
    offset: u64,
    armed: bool,
}

impl FeedRelay {
    fn new() -> Self {
        FeedRelay {
            offset: 0,
            armed: false,
        }
    }

    fn tick(&mut self, folder: &Path, child: u32, on_line: &impl Fn(String)) {
        if !self.armed {
            match read_run(folder) {
                Some(run) if run.pid == child || run.pgid == Some(child) => self.armed = true,
                _ => return,
            }
        }

        let (lines, next) = appended_lines(folder, self.offset);

        self.offset = next;

        for line in lines {
            on_line(line);
        }
    }
}

fn scan_relayed(
    runner: &ToolRunner,
    folder: &Path,
    on_line: &(impl Fn(String) + Sync),
) -> Result<(), String> {
    let mut args = words(&["scan", "--extract"]);

    args.push(folder.display().to_string());

    let mut process = runner
        .command(RECOGNIZER_COMMAND)
        .map_err(|fault| fault.message())?;

    process
        .args(&args)
        .current_dir(folder)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;

        process.process_group(0);
    }

    let missing = || {
        ToolFault::Missing {
            tool: RECOGNIZER_COMMAND.to_string(),
        }
        .message()
    };
    let mut child = process.spawn().map_err(|_| missing())?;
    let pid = child.id();
    let finished = AtomicBool::new(false);

    std::thread::scope(|scope| {
        scope.spawn(|| {
            let mut relay = FeedRelay::new();

            while !finished.load(Ordering::SeqCst) {
                relay.tick(folder, pid, on_line);
                std::thread::sleep(FEED_POLL);
            }

            relay.tick(folder, pid, on_line);
        });

        let waited = runner.limited(|| child.wait());

        finished.store(true, Ordering::SeqCst);

        waited.map(|_| ()).map_err(|_| missing())
    })
}

fn survey_flow(
    extract: bool,
    mut survey: impl FnMut() -> Result<Value, String>,
    scan: impl FnOnce() -> Result<(), String>,
    doctor: impl FnOnce() -> DoctorRead,
    on_line: &impl Fn(String),
) -> SurveyRead {
    on_line(step_line("survey", "run"));

    let mut read = match survey() {
        Ok(read) => read,
        Err(reason) => return SurveyRead::Unavailable { reason },
    };

    on_line(step_line("survey", "done"));

    let scanned = extract && read.get("files").is_some_and(Value::is_null);

    if scanned {
        on_line(step_line("scan", "run"));

        if let Err(reason) = scan() {
            return SurveyRead::Unavailable { reason };
        }

        on_line(step_line("scan", "done"));
    }

    on_line(step_line("reading", "run"));

    if scanned {
        read = match survey() {
            Ok(read) => read,
            Err(reason) => return SurveyRead::Unavailable { reason },
        };
    }

    let doctor = doctor();

    on_line(step_line("reading", "done"));

    SurveyRead::Ok {
        survey: read,
        doctor,
    }
}

pub fn read_survey(
    runner: &ToolRunner,
    folder: &Path,
    extract: bool,
    runs: &SetupRuns,
    label: &str,
    on_line: impl Fn(String) + Sync,
) -> SurveyRead {
    let key = runs.begin_read(label);
    let started = |pid: u32| runs.started_read(&key, pid);

    let read = survey_flow(
        extract,
        || survey_of(runner, folder, started),
        || scan_relayed(runner, folder, &on_line),
        || read_doctor(runner, folder, started),
        &on_line,
    );

    runs.finish_read(&key);

    read
}

pub struct TempFile {
    path: PathBuf,
}

impl TempFile {
    pub fn write(label: &str, kind: &str, text: &str) -> Result<TempFile, String> {
        let safe: String = label
            .chars()
            .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
            .collect();
        let path = std::env::temp_dir().join(format!(
            "recognizer-setup-{}-{safe}-{kind}.json",
            std::process::id()
        ));
        let mut options = std::fs::OpenOptions::new();

        options.write(true).create(true).truncate(true);

        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;

            options.mode(0o600);
        }

        let mut file = options
            .open(&path)
            .map_err(|error| format!("cannot write {}: {error}", path.display()))?;
        let file_path = TempFile { path: path.clone() };

        file.write_all(text.as_bytes())
            .map_err(|error| format!("cannot write {}: {error}", path.display()))?;

        Ok(file_path)
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for TempFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub enum SetupRun {
    Finished { result: Value },
    Failed { reason: String },
    Refused { reason: String },
}

pub fn stream_child(
    runs: &SetupRuns,
    label: &str,
    mut process: Command,
    on_line: impl Fn(String),
) -> SetupRun {
    process
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
        Err(error) => {
            return SetupRun::Failed {
                reason: format!("{RECOGNIZER_COMMAND} could not start: {error}"),
            }
        }
    };

    runs.started(label, child.id());

    let stderr = child.stderr.take();
    let errors = std::thread::spawn(move || {
        let mut bytes = Vec::new();

        if let Some(mut stderr) = stderr {
            let _ = stderr.read_to_end(&mut bytes);
        }

        String::from_utf8_lossy(&bytes).into_owned()
    });
    let mut result = None;

    if let Some(stdout) = child.stdout.take() {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Ok(value) = serde_json::from_str::<Value>(&line) {
                if value.get("event").and_then(Value::as_str) == Some("result") {
                    result = Some(value);
                }
            }

            on_line(line);
        }
    }

    let status = child.wait().ok();
    let detail = errors.join().unwrap_or_default();

    match result {
        Some(result) => SetupRun::Finished { result },
        None => SetupRun::Failed {
            reason: format!(
                "recognizer exited {} without a result: {}",
                status
                    .and_then(|status| status.code())
                    .map_or("by signal".to_string(), |code| code.to_string()),
                tail_chars(clean_output(&detail).as_str())
            ),
        },
    }
}

#[allow(clippy::too_many_arguments)]
pub fn run_setup_verb(
    runs: &SetupRuns,
    label: &str,
    folder: &Path,
    runner: &ToolRunner,
    verb: &str,
    choices: &str,
    on_line: impl Fn(String),
) -> SetupRun {
    if let Some(run) = live_run(folder) {
        return SetupRun::Refused {
            reason: refusal_text(&run, folder),
        };
    }

    let file = match TempFile::write(label, "choices", choices) {
        Ok(file) => file,
        Err(reason) => return SetupRun::Failed { reason },
    };
    let mut process = match runner.command(RECOGNIZER_COMMAND) {
        Ok(process) => process,
        Err(fault) => {
            return SetupRun::Failed {
                reason: fault.message(),
            }
        }
    };

    process
        .args(["setup", verb])
        .arg(folder)
        .arg("--choices")
        .arg(file.path())
        .current_dir(folder);

    if let Err(reason) = runs.begin(label) {
        return SetupRun::Refused { reason };
    }

    let end = stream_child(runs, label, process, on_line);

    runs.finish(label);

    end
}

#[allow(clippy::too_many_arguments)]
pub fn run_recommend(
    runs: &SetupRuns,
    label: &str,
    folder: &Path,
    runner: &ToolRunner,
    model: &str,
    prompt: &str,
    schema: &str,
    on_line: impl Fn(String),
) -> SetupCheck {
    match run_check(runs, label, folder, runner, model, prompt, schema, on_line) {
        SetupCheck::Proposal {
            output,
            cost_usd,
            duration_ms,
            denials,
        } => match recommendation_of(runner, folder, label, &output) {
            Ok(recommendation) => SetupCheck::Proposal {
                output: recommendation,
                cost_usd,
                duration_ms,
                denials,
            },
            Err(reason) => SetupCheck::Failed {
                reason,
                subtype: None,
                cost_usd,
                duration_ms,
            },
        },
        other => other,
    }
}

fn recommendation_of(
    runner: &ToolRunner,
    folder: &Path,
    label: &str,
    answer: &Value,
) -> Result<Value, String> {
    let file = TempFile::write(label, "answer", &answer.to_string())?;
    let mut args = words(&["setup", "recommend"]);

    args.push(folder.display().to_string());
    args.push("--input".to_string());
    args.push(file.path().display().to_string());

    let captured =
        capture_recognizer(runner, folder, &args, |_| {}).map_err(|fault| fault.message())?;

    if captured.code != Some(0) {
        return Err(tail_chars(captured.stderr.trim()));
    }

    serde_json::from_str::<Value>(&captured.stdout)
        .map_err(|_| "recognizer setup recommend printed no JSON".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    fn strings(parts: &[&str]) -> Vec<String> {
        parts.iter().map(|part| part.to_string()).collect()
    }

    fn read(relative: &str) -> String {
        std::fs::read_to_string(format!("{}/{relative}", env!("CARGO_MANIFEST_DIR"))).unwrap()
    }

    #[test]
    fn claude_args_is_exactly_the_bound_flag_set() {
        let args = claude_args("sonnet", "{}");
        let at = args.iter().position(|arg| arg == "--allowedTools").unwrap();
        let rules = &args[at + 1..at + 10];

        assert_eq!(
            rules,
            strings(&[
                "Read",
                "Glob",
                "Grep",
                "Bash(recognizer help:*)",
                "Bash(recognizer plugins:*)",
                "Bash(recognizer doctor:*)",
                "Bash(recognizer scan --extract)",
                "Bash(recognizer uses:*)",
                "Bash(recognizer used-by:*)",
            ])
        );
        assert_eq!(args[at + 10], "--setting-sources");
        assert_eq!(args[at + 11], "");

        let mode = args
            .iter()
            .position(|arg| arg == "--permission-mode")
            .unwrap();

        assert_eq!(args[mode + 1], "dontAsk");
        assert_eq!(
            args[args.iter().position(|arg| arg == "--model").unwrap() + 1],
            "sonnet"
        );

        for forbidden in ["Write", "Edit", "NotebookEdit", "sensors"] {
            assert!(!args.iter().any(|arg| arg == forbidden), "{forbidden}");
        }

        assert!(!args.iter().any(|arg| arg.contains("--dangerously")));
        assert!(!args.iter().any(|arg| arg.contains("sensors check")));
        assert!(args.contains(&"--strict-mcp-config".to_string()));
        assert!(args.contains(&"--disable-slash-commands".to_string()));
        assert!(args.contains(&"--no-session-persistence".to_string()));
    }

    #[test]
    fn setup_recommend_args_hold_the_read_only_allowlist() {
        let args = claude_args("sonnet", "{\"type\":\"object\"}");

        assert!(args.contains(&"Bash(recognizer uses:*)".to_string()));
        assert!(args.contains(&"Bash(recognizer used-by:*)".to_string()));
        assert!(!args.iter().any(|arg| arg == "--max-budget-usd"));

        let at = args.iter().position(|arg| arg == "--json-schema").unwrap();

        assert_eq!(args[at + 1], "{\"type\":\"object\"}");
    }

    #[test]
    fn every_setup_command_is_registered_permitted_and_listed() {
        let build = read("build.rs");
        let app = read("permissions/app.toml");
        let lib = read("src/lib.rs");

        for name in [
            "setup_survey",
            "setup_recommend",
            "setup_apply",
            "setup_try",
            "stop_setup",
        ] {
            let allow = format!("allow-{}", name.replace('_', "-"));

            assert!(build.contains(&format!("\"{name}\"")), "build.rs {name}");
            assert!(app.contains(&format!("\"{allow}\"")), "app.toml {allow}");
            assert!(lib.contains(&format!("{name},")), "lib.rs {name}");
            assert!(
                std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                    .join(format!("permissions/autogenerated/{name}.toml"))
                    .exists(),
                "permission file {name}"
            );
        }

        for gone in ["read_doctor", "run_setup_check", "apply_setup"] {
            let hyphenated = gone.replace('_', "-");

            assert!(!build.contains(gone), "build.rs {gone}");
            assert!(!app.contains(&hyphenated), "app.toml {gone}");
            assert!(!lib.contains(&format!("{gone},")), "lib.rs {gone}");
            assert!(
                !std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                    .join(format!("permissions/autogenerated/{gone}.toml"))
                    .exists(),
                "permission file {gone}"
            );
        }
    }

    #[test]
    fn the_stream_parser_yields_progress_and_result_facts() {
        let tool = r#"{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":".recognizer/policy.yaml"}}]}}"#;
        let bash = r#"{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"recognizer doctor"}}]}}"#;
        let text = r#"{"type":"assistant","message":{"content":[{"type":"text","text":"hello"}]}}"#;
        let good = r#"{"type":"result","subtype":"success","is_error":false,"duration_ms":1200,"total_cost_usd":0.42,"structured_output":{"changes":[]},"permission_denials":[1,2]}"#;
        let bad = r#"{"type":"result","subtype":"error_max_budget_usd","is_error":true,"total_cost_usd":2.1,"duration_ms":5}"#;

        assert_eq!(parse_line(tool).0, vec!["Read .recognizer/policy.yaml"]);
        assert_eq!(parse_line(bash).0, vec!["Bash recognizer doctor"]);
        assert_eq!(parse_line(text), (Vec::new(), None));

        let facts = parse_line(good).1.unwrap();

        assert_eq!(
            facts.structured_output,
            Some(serde_json::json!({"changes": []}))
        );
        assert_eq!(facts.total_cost_usd, Some(0.42));
        assert_eq!(facts.duration_ms, Some(1200));
        assert_eq!(facts.permission_denials, 2);
        assert!(!facts.is_error);

        let failed = parse_line(bad).1.unwrap();

        assert!(failed.is_error);
        assert_eq!(failed.subtype.as_deref(), Some("error_max_budget_usd"));
        assert_eq!(failed.structured_output, None);

        assert_eq!(parse_line(&good[..40]), (Vec::new(), None));
        assert_eq!(parse_line(""), (Vec::new(), None));
    }

    #[test]
    fn a_result_is_a_proposal_a_failure_or_a_signal_exit() {
        let good = parse_line(r#"{"type":"result","is_error":false,"structured_output":{"changes":[]},"total_cost_usd":1.0,"duration_ms":9}"#).1;

        assert!(matches!(
            outcome_of(good, Some(0), ""),
            SetupCheck::Proposal { .. }
        ));

        let none = parse_line(r#"{"type":"result","is_error":false,"subtype":"success"}"#).1;

        assert!(matches!(
            outcome_of(none, Some(0), ""),
            SetupCheck::Failed { .. }
        ));

        match outcome_of(None, Some(1), "Claude usage limit reached") {
            SetupCheck::Failed { reason, .. } => assert!(reason.contains("limit"), "{reason}"),
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn a_signed_out_claude_gets_the_app_s_own_reason_and_a_limit_keeps_its_own() {
        let signed_out = parse_line(r#"{"type":"result","subtype":"success","is_error":true,"api_error_status":null,"duration_ms":53,"total_cost_usd":0,"result":"Not logged in · Please run /login","terminal_reason":"api_error"}"#).1;

        match outcome_of(signed_out, Some(1), "") {
            SetupCheck::Failed { reason, .. } => assert_eq!(
                reason,
                "Claude Code is not signed in. Open a terminal, run claude and sign in, then try again."
            ),
            other => panic!("{other:?}"),
        }

        let limited = parse_line(r#"{"type":"result","subtype":"success","is_error":true,"result":"Claude usage limit reached"}"#).1;

        match outcome_of(limited, Some(1), "") {
            SetupCheck::Failed { reason, .. } => assert_eq!(reason, "Claude usage limit reached"),
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn a_setup_run_event_line_is_forwarded_whole() {
        let runs = SetupRuns::default();
        let file = TempFile::write("w-test", "choices", "{}").unwrap();
        let path = file.path().to_path_buf();
        let mut process = Command::new("sh");

        process.args(["-c", r#"echo '{"event":"start","total":1}'; exit 1"#]);
        runs.begin("w-test").unwrap();

        let seen = RefCell::new(Vec::new());
        let end = stream_child(&runs, "w-test", process, |line| {
            seen.borrow_mut().push(line)
        });

        runs.finish("w-test");

        assert_eq!(*seen.borrow(), vec![r#"{"event":"start","total":1}"#]);
        assert!(matches!(end, SetupRun::Failed { .. }));
        assert!(path.exists());

        drop(file);

        assert!(!path.exists());
    }

    #[test]
    fn a_result_line_is_the_run_end() {
        let runs = SetupRuns::default();
        let mut process = Command::new("sh");

        process.args([
            "-c",
            r#"echo '{"event":"start","total":0}'; echo '{"event":"result","ok":true}'"#,
        ]);
        runs.begin("w-1").unwrap();

        let end = stream_child(&runs, "w-1", process, |_| {});

        assert_eq!(
            end,
            SetupRun::Finished {
                result: serde_json::json!({"event": "result", "ok": true})
            }
        );
    }

    #[test]
    fn doctor_exit_one_with_json_is_a_result_and_exit_two_is_not() {
        let report = |code: i32, stdout: &str| {
            doctor_from(Ok(Captured {
                code: Some(code),
                stdout: stdout.to_string(),
                stderr: "bad".to_string(),
            }))
        };

        assert!(matches!(
            report(1, r#"{"problems":2}"#),
            DoctorRead::Ok { .. }
        ));
        assert!(matches!(
            report(0, r#"{"problems":0}"#),
            DoctorRead::Ok { .. }
        ));
        assert!(matches!(report(2, ""), DoctorRead::Unavailable { .. }));
        assert!(matches!(
            report(1, "not json"),
            DoctorRead::Unavailable { .. }
        ));
    }

    #[test]
    fn one_run_per_window_and_stop_marks_it() {
        let runs = SetupRuns::default();

        assert!(runs.begin("w-1").is_ok());
        assert!(runs.begin("w-1").is_err());
        assert!(runs.begin("w-2").is_ok());
        assert!(!runs.stopped("w-1"));

        runs.stop("w-1");

        assert!(runs.stopped("w-1"));
        assert!(!runs.stopped("w-2"));
        assert!(runs.finish("w-1"));
        assert!(!runs.running("w-1"));
    }

    fn shell(script: &str) -> Command {
        let mut process = Command::new("sh");

        process.args(["-c", script]);

        process
    }

    #[cfg(unix)]
    #[test]
    fn capture_command_puts_the_child_in_its_own_process_group() {
        let runner = crate::tool_runner::runner();
        let pid = std::sync::atomic::AtomicU32::new(0);
        let captured = capture_command(runner, shell("ps -o pgid= -p $$"), |started| {
            pid.store(started, std::sync::atomic::Ordering::SeqCst)
        })
        .unwrap();

        let recorded = pid.load(std::sync::atomic::Ordering::SeqCst);

        assert_ne!(recorded, 0);
        assert_eq!(captured.stdout.trim(), recorded.to_string());
    }

    #[cfg(unix)]
    fn stopped_read_returns(stop_after_pid: bool) {
        let runs = std::sync::Arc::new(SetupRuns::default());
        let key = runs.begin_read("w-1");
        let (sender, receiver) = std::sync::mpsc::channel();
        let worker = {
            let runs = runs.clone();
            let key = key.clone();

            std::thread::spawn(move || {
                let captured =
                    capture_command(crate::tool_runner::runner(), shell("sleep 30"), |pid| {
                        if !stop_after_pid {
                            runs.stop("w-1");
                        }

                        runs.started_read(&key, pid);
                        sender.send(()).unwrap();
                    });

                captured.unwrap().code
            })
        };

        receiver.recv_timeout(Duration::from_secs(10)).unwrap();

        if stop_after_pid {
            runs.stop("w-1");
        }

        let begun = std::time::Instant::now();

        assert_eq!(worker.join().unwrap(), None);
        assert!(begun.elapsed() < Duration::from_secs(10));

        runs.finish_read(&key);
    }

    #[cfg(unix)]
    #[test]
    fn stopping_a_read_ends_its_group() {
        stopped_read_returns(true);
        stopped_read_returns(false);
    }

    #[test]
    fn a_read_does_not_count_as_a_running_setup() {
        let runs = SetupRuns::default();
        let key = runs.begin_read("w-1");

        assert_eq!(runs.running_count(), 0);
        assert!(runs.begin("w-1").is_ok());

        runs.finish("w-1");
        runs.finish_read(&key);
    }

    #[test]
    fn running_count_counts_every_setup_run() {
        let runs = SetupRuns::default();

        assert_eq!(runs.running_count(), 0);

        runs.begin("w-1").unwrap();
        runs.begin("w-2").unwrap();

        assert_eq!(runs.running_count(), 2);

        runs.finish("w-1");

        assert_eq!(runs.running_count(), 1);
    }

    fn marker_text(pid: u32) -> String {
        format!(
            r#"{{"version":5,"run_id":"r","pid":{pid},"pgid":{pid},"started_at":"2026-01-01T00:00:00.000Z","started_by":"app","repository":"/work/shop","sensors":[],"describe":false,"suites":{{}},"phase":"running","ended_at":null,"exit":null,"gaps":[],"failure":null,"commit":null,"ran":null}}"#
        )
    }

    fn cache(folder: &Path) -> PathBuf {
        let cache = folder.join(".recognizer/cache");

        std::fs::create_dir_all(&cache).unwrap();

        cache
    }

    fn append(folder: &Path, text: &str) {
        use std::io::Write;

        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(cache(folder).join("scan-running.progress.jsonl"))
            .unwrap();

        file.write_all(text.as_bytes()).unwrap();
    }

    fn collected(relay: &mut FeedRelay, folder: &Path, child: u32, seen: &RefCell<Vec<String>>) {
        relay.tick(folder, child, &|line| seen.borrow_mut().push(line));
    }

    #[test]
    fn the_relay_forwards_feed_lines_appended_in_two_chunks_and_holds_a_partial_line() {
        let dir = tempfile::tempdir().unwrap();
        let folder = dir.path();
        let seen = RefCell::new(Vec::new());
        let mut relay = FeedRelay::new();

        std::fs::write(cache(folder).join("scan-running.json"), marker_text(4242)).unwrap();
        append(folder, "{\"event\":\"a\"}\n{\"event\":");
        collected(&mut relay, folder, 4242, &seen);

        assert_eq!(*seen.borrow(), strings(&["{\"event\":\"a\"}"]));

        append(folder, "\"b\"}\n");
        collected(&mut relay, folder, 4242, &seen);

        assert_eq!(
            *seen.borrow(),
            strings(&["{\"event\":\"a\"}", "{\"event\":\"b\"}"])
        );
    }

    #[test]
    fn the_relay_forwards_nothing_until_the_marker_names_the_child() {
        let dir = tempfile::tempdir().unwrap();
        let folder = dir.path();
        let seen = RefCell::new(Vec::new());
        let mut relay = FeedRelay::new();

        append(folder, "{\"event\":\"stale\"}\n");
        collected(&mut relay, folder, 4242, &seen);

        assert!(seen.borrow().is_empty());

        std::fs::write(cache(folder).join("scan-running.json"), marker_text(9999)).unwrap();
        collected(&mut relay, folder, 4242, &seen);

        assert!(seen.borrow().is_empty());

        std::fs::write(cache(folder).join("scan-running.json"), marker_text(4242)).unwrap();
        collected(&mut relay, folder, 4242, &seen);

        assert_eq!(*seen.borrow(), strings(&["{\"event\":\"stale\"}"]));
    }

    fn flow(files_null: bool, extract: bool) -> Vec<String> {
        let seen = RefCell::new(Vec::new());
        let files = if files_null {
            Value::Null
        } else {
            Value::from(1)
        };
        let result = survey_flow(
            extract,
            || Ok(serde_json::json!({ "files": files })),
            || Ok(()),
            || DoctorRead::Unavailable {
                reason: "x".to_string(),
            },
            &|line| seen.borrow_mut().push(line),
        );

        assert!(matches!(result, SurveyRead::Ok { .. }));

        seen.into_inner()
    }

    #[test]
    fn the_step_lines_arrive_survey_scan_reading_on_an_unscanned_folder() {
        assert_eq!(
            flow(true, true),
            strings(&[
                r#"{"event":"step","step":"survey","state":"run"}"#,
                r#"{"event":"step","step":"survey","state":"done"}"#,
                r#"{"event":"step","step":"scan","state":"run"}"#,
                r#"{"event":"step","step":"scan","state":"done"}"#,
                r#"{"event":"step","step":"reading","state":"run"}"#,
                r#"{"event":"step","step":"reading","state":"done"}"#,
            ])
        );
    }

    #[test]
    fn the_step_lines_arrive_survey_reading_on_a_scanned_folder() {
        assert_eq!(
            flow(false, true),
            strings(&[
                r#"{"event":"step","step":"survey","state":"run"}"#,
                r#"{"event":"step","step":"survey","state":"done"}"#,
                r#"{"event":"step","step":"reading","state":"run"}"#,
                r#"{"event":"step","step":"reading","state":"done"}"#,
            ])
        );
    }
}
