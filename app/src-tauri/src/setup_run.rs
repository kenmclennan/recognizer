use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::Path;
use std::process::Stdio;
use std::sync::Mutex;

use serde::Serialize;
use serde_json::Value;

use crate::repository::{clean_output, RECOGNIZER_COMMAND};
use crate::scan_run::{kill_group, live_run, refusal_text};
use crate::tool_runner::{Captured, ToolFault, ToolRunner};

const MAX_ARGUMENTS: usize = 20;
const MAX_ARGUMENT_LENGTH: usize = 4096;
const MAX_BUDGET: f64 = 100.0;
const STDERR_CHARS: usize = 2000;
const LIMIT_TEXT: &str = "usage limit";

const ALLOWED_TOOLS: [&str; 7] = [
    "Read",
    "Glob",
    "Grep",
    "Bash(recognizer help:*)",
    "Bash(recognizer plugins:*)",
    "Bash(recognizer doctor:*)",
    "Bash(recognizer scan --extract)",
];

#[derive(Default)]
struct Live {
    pid: Option<u32>,
    stopped: bool,
}

#[derive(Default)]
pub struct SetupRuns {
    live: Mutex<HashMap<String, Live>>,
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

    pub fn stop(&self, label: &str) {
        let mut live = self.lock();

        if let Some(run) = live.get_mut(label) {
            run.stopped = true;

            if let Some(pid) = run.pid {
                kill_group(pid);
            }
        }
    }

    pub fn stop_all(&self) {
        let labels: Vec<String> = self.lock().keys().cloned().collect();

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
}

pub fn budget_ok(budget: Option<f64>) -> Option<f64> {
    budget.filter(|value| value.is_finite() && *value > 0.0 && *value < MAX_BUDGET)
}

pub fn claude_args(model: &str, schema: &str, budget: Option<f64>) -> Vec<String> {
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

    if let Some(budget) = budget_ok(budget) {
        args.push("--max-budget-usd".to_string());
        args.push(budget.to_string());
    }

    args
}

pub fn command_refusal(argv: &[String]) -> Option<String> {
    if argv.len() > MAX_ARGUMENTS {
        return Some(format!("more than {MAX_ARGUMENTS} arguments"));
    }

    for argument in argv {
        if argument == "--repository" {
            return Some("carries --repository".to_string());
        }

        if argument.contains('\0') {
            return Some("an argument contains a NUL".to_string());
        }

        if argument.chars().count() > MAX_ARGUMENT_LENGTH {
            return Some(format!(
                "an argument is longer than {MAX_ARGUMENT_LENGTH} characters"
            ));
        }
    }

    if argv.first().map(String::as_str) != Some(RECOGNIZER_COMMAND) {
        return Some("not a recognizer command".to_string());
    }

    match argv.get(1).map(String::as_str) {
        Some("config") | Some("policy") => None,
        Some("plugin") => {
            if argv.get(2).map(String::as_str) == Some("add") {
                None
            } else {
                Some("only plugin add is allowed".to_string())
            }
        }
        Some("scan") => {
            if argv.len() == 2 {
                None
            } else {
                Some("scan takes no argument".to_string())
            }
        }
        Some("sensors") if argv.get(2).map(String::as_str) == Some("check") => {
            let rest = &argv[3..];
            let runs = rest.iter().filter(|argument| *argument == "--run").count();
            let names: Vec<&String> = rest
                .iter()
                .filter(|argument| *argument != "--run")
                .collect();

            if runs > 1 || names.len() > 1 || names.iter().any(|name| name.starts_with('-')) {
                Some("sensors check takes --run and at most one sensor name".to_string())
            } else {
                None
            }
        }
        _ => Some("not a command setup may run".to_string()),
    }
}

pub fn runner_args(argv: &[String], folder: &Path) -> Vec<String> {
    let repository = folder.display().to_string();
    let mut args = vec![argv[1].clone()];

    match argv[1].as_str() {
        "scan" => args.push(repository),
        "config" | "policy" => {
            args.push("--repository".to_string());
            args.push(repository);
            args.extend(argv[2..].iter().cloned());
        }
        _ => {
            args.push(argv[2].clone());
            args.push("--repository".to_string());
            args.push(repository);
            args.extend(argv[3..].iter().cloned());
        }
    }

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
                reason: facts
                    .text
                    .filter(|text| !text.trim().is_empty())
                    .unwrap_or_else(|| "claude answered without a proposal".to_string()),
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
    budget: Option<f64>,
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
        .args(claude_args(model, schema, budget))
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
pub enum SetupApply {
    Applied {
        applied: usize,
        total: usize,
    },
    Failed {
        applied: usize,
        total: usize,
        command: Vec<String>,
        code: Option<i32>,
        stderr: String,
    },
    Stopped {
        applied: usize,
        total: usize,
    },
    Refused {
        reason: String,
    },
}

pub fn apply_with(
    commands: &[Vec<String>],
    stopped: impl Fn() -> bool,
    mut run: impl FnMut(&[String]) -> Result<Captured, ToolFault>,
) -> SetupApply {
    for argv in commands {
        if let Some(reason) = command_refusal(argv) {
            return SetupApply::Refused {
                reason: format!("{}: {reason}", argv.join(" ")),
            };
        }
    }

    let total = commands.len();

    for (applied, argv) in commands.iter().enumerate() {
        if stopped() {
            return SetupApply::Stopped { applied, total };
        }

        let captured = match run(argv) {
            Ok(captured) => captured,
            Err(fault) => {
                return SetupApply::Failed {
                    applied,
                    total,
                    command: argv.clone(),
                    code: None,
                    stderr: fault.message(),
                }
            }
        };

        if stopped() {
            return SetupApply::Stopped {
                applied: applied + usize::from(captured.code == Some(0)),
                total,
            };
        }

        if captured.code != Some(0) {
            return SetupApply::Failed {
                applied,
                total,
                command: argv.clone(),
                code: captured.code,
                stderr: tail_chars(captured.stderr.trim()),
            };
        }
    }

    SetupApply::Applied {
        applied: total,
        total,
    }
}

pub fn run_recognizer(
    runs: &SetupRuns,
    label: &str,
    folder: &Path,
    runner: &ToolRunner,
    args: &[String],
) -> Result<Captured, ToolFault> {
    let mut process = runner.command(RECOGNIZER_COMMAND)?;

    process
        .args(args)
        .current_dir(folder)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;

        process.process_group(0);
    }

    let missing = || ToolFault::Missing {
        tool: RECOGNIZER_COMMAND.to_string(),
    };
    let mut child = process.spawn().map_err(|_| missing())?;

    runs.started(label, child.id());

    let mut stdout = child.stdout.take().ok_or_else(missing)?;
    let mut stderr = child.stderr.take().ok_or_else(missing)?;
    let out = std::thread::spawn(move || {
        let mut bytes = Vec::new();

        let _ = stdout.read_to_end(&mut bytes);

        bytes
    });
    let err = std::thread::spawn(move || {
        let mut bytes = Vec::new();

        let _ = stderr.read_to_end(&mut bytes);

        bytes
    });
    let status = child.wait().ok();

    Ok(Captured {
        code: status.and_then(|status| status.code()),
        stdout: String::from_utf8_lossy(&out.join().unwrap_or_default()).into_owned(),
        stderr: String::from_utf8_lossy(&err.join().unwrap_or_default()).into_owned(),
    })
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

pub fn read_doctor(runner: &ToolRunner, folder: &Path) -> DoctorRead {
    doctor_from(runner.command(RECOGNIZER_COMMAND).and_then(|mut process| {
        process
            .args(["doctor", "--json"])
            .current_dir(folder)
            .stdin(Stdio::null());

        runner
            .limited(|| process.output())
            .map(|output| Captured {
                code: output.status.code(),
                stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
                stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
            })
            .map_err(|_| ToolFault::Missing {
                tool: RECOGNIZER_COMMAND.to_string(),
            })
    }))
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ApplyResult {
    pub outcome: SetupApply,
    pub doctor: DoctorRead,
}

pub fn apply_setup_run(
    runs: &SetupRuns,
    label: &str,
    folder: &Path,
    runner: &ToolRunner,
    commands: &[Vec<String>],
) -> ApplyResult {
    for argv in commands {
        if let Some(reason) = command_refusal(argv) {
            return ApplyResult {
                outcome: SetupApply::Refused {
                    reason: format!("{}: {reason}", argv.join(" ")),
                },
                doctor: read_doctor(runner, folder),
            };
        }
    }

    if let Some(run) = live_run(folder) {
        return ApplyResult {
            outcome: SetupApply::Refused {
                reason: refusal_text(&run, folder),
            },
            doctor: read_doctor(runner, folder),
        };
    }

    if let Err(reason) = runs.begin(label) {
        return ApplyResult {
            outcome: SetupApply::Refused { reason },
            doctor: read_doctor(runner, folder),
        };
    }

    let outcome = apply_with(
        commands,
        || runs.stopped(label),
        |argv| run_recognizer(runs, label, folder, runner, &runner_args(argv, folder)),
    );

    runs.finish(label);

    ApplyResult {
        outcome,
        doctor: read_doctor(runner, folder),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    fn strings(parts: &[&str]) -> Vec<String> {
        parts.iter().map(|part| part.to_string()).collect()
    }

    fn fixture() -> Value {
        let text = std::fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../fixtures/setup/commands.json"
        ))
        .unwrap();

        serde_json::from_str(&text).unwrap()
    }

    fn argv_of(value: &Value) -> Vec<String> {
        value
            .as_array()
            .unwrap()
            .iter()
            .map(|part| part.as_str().unwrap().to_string())
            .collect()
    }

    fn ok(code: i32, stderr: &str) -> Result<Captured, ToolFault> {
        Ok(Captured {
            code: Some(code),
            stdout: String::new(),
            stderr: stderr.to_string(),
        })
    }

    #[test]
    fn claude_args_is_exactly_the_bound_flag_set() {
        let args = claude_args("sonnet", "{}", None);
        let at = args.iter().position(|arg| arg == "--allowedTools").unwrap();
        let rules = &args[at + 1..at + 8];

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
            ])
        );
        assert_eq!(args[at + 8], "--setting-sources");
        assert_eq!(args[at + 9], "");

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
    fn the_budget_flag_appears_only_for_a_valid_budget() {
        let has = |budget: Option<f64>| {
            claude_args("sonnet", "{}", budget)
                .iter()
                .any(|arg| arg == "--max-budget-usd")
        };

        assert!(has(Some(2.08)));
        assert!(has(Some(99.99)));
        assert!(!has(Some(100.0)));
        assert!(!has(Some(100.01)));
        assert!(!has(Some(0.0)));
        assert!(!has(Some(-1.0)));
        assert!(!has(Some(f64::NAN)));
        assert!(!has(Some(f64::INFINITY)));
        assert!(!has(None));
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
    fn the_grammar_matches_the_shared_fixture() {
        let fixture = fixture();
        let accepted = fixture["accepted"].as_array().unwrap();
        let refused = fixture["refused"].as_array().unwrap();

        assert!(!accepted.is_empty());
        assert!(!refused.is_empty());

        for entry in accepted {
            let argv = argv_of(entry);

            assert_eq!(command_refusal(&argv), None, "{argv:?}");
        }

        for entry in refused {
            let argv = argv_of(&entry["argv"]);
            let reason = entry["reason"].as_str().unwrap();

            assert_eq!(command_refusal(&argv).as_deref(), Some(reason), "{reason}");
        }
    }

    #[test]
    fn a_refused_command_means_none_run() {
        let calls = RefCell::new(0);
        let commands = vec![
            strings(&["recognizer", "config", "--unset", "a.b"]),
            strings(&["recognizer", "plugin", "check", "x"]),
        ];

        let outcome = apply_with(
            &commands,
            || false,
            |_| {
                *calls.borrow_mut() += 1;

                ok(0, "")
            },
        );

        assert!(matches!(outcome, SetupApply::Refused { .. }));
        assert_eq!(*calls.borrow(), 0);
    }

    #[test]
    fn the_first_failure_stops_the_apply_and_reports_one_of_three() {
        let calls = RefCell::new(Vec::new());
        let commands = vec![
            strings(&["recognizer", "config", "--unset", "a.b"]),
            strings(&["recognizer", "config", "--unset", "c.d"]),
            strings(&["recognizer", "config", "--unset", "e.f"]),
        ];

        let outcome = apply_with(
            &commands,
            || false,
            |argv| {
                calls.borrow_mut().push(argv.to_vec());

                if argv[3] == "c.d" {
                    ok(1, "boom: no such key")
                } else {
                    ok(0, "")
                }
            },
        );

        assert_eq!(
            outcome,
            SetupApply::Failed {
                applied: 1,
                total: 3,
                command: commands[1].clone(),
                code: Some(1),
                stderr: "boom: no such key".to_string(),
            }
        );
        assert_eq!(calls.borrow().len(), 2);
    }

    #[test]
    fn every_command_applies_in_order_when_all_succeed() {
        let calls = RefCell::new(Vec::new());
        let commands = vec![
            strings(&["recognizer", "scan"]),
            strings(&["recognizer", "plugin", "add", "claude"]),
        ];

        let outcome = apply_with(
            &commands,
            || false,
            |argv| {
                calls.borrow_mut().push(argv.to_vec());

                ok(0, "")
            },
        );

        assert_eq!(
            outcome,
            SetupApply::Applied {
                applied: 2,
                total: 2
            }
        );
        assert_eq!(*calls.borrow(), commands);
    }

    #[test]
    fn a_stop_halts_before_the_next_command() {
        let commands = vec![
            strings(&["recognizer", "scan"]),
            strings(&["recognizer", "scan"]),
        ];
        let seen = RefCell::new(0);

        let outcome = apply_with(
            &commands,
            || *seen.borrow() >= 1,
            |_| {
                *seen.borrow_mut() += 1;

                ok(0, "")
            },
        );

        assert_eq!(
            outcome,
            SetupApply::Stopped {
                applied: 1,
                total: 2
            }
        );
        assert_eq!(*seen.borrow(), 1);
    }

    #[test]
    fn repository_is_inserted_by_rust_after_the_verb() {
        let folder = Path::new("/work/repo");

        assert_eq!(
            runner_args(
                &strings(&["recognizer", "config", "--unset", "a.b"]),
                folder
            ),
            strings(&["config", "--repository", "/work/repo", "--unset", "a.b"])
        );
        assert_eq!(
            runner_args(&strings(&["recognizer", "scan"]), folder),
            strings(&["scan", "/work/repo"])
        );
        assert_eq!(
            runner_args(&strings(&["recognizer", "plugin", "add", "claude"]), folder),
            strings(&["plugin", "add", "--repository", "/work/repo", "claude"])
        );
        assert_eq!(
            runner_args(
                &strings(&["recognizer", "sensors", "check", "--run"]),
                folder
            ),
            strings(&["sensors", "check", "--repository", "/work/repo", "--run"])
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
}
