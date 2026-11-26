use serde_json::{json, Value};
use std::fs;
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};
use std::time::Instant;

pub const LANGUAGE: &str = "rust";
pub const KEY: &str = "run";
pub const KEPT_RUNS: usize = 5;
pub const MOVE_MS: f64 = 1000.0;

pub type Clock = Box<dyn Fn() -> f64>;

#[derive(Clone, Debug, PartialEq)]
pub struct Run {
    pub ms: f64,
    pub units: f64,
}

pub fn awake_clock() -> Clock {
    let origin = Instant::now();

    Box::new(move || origin.elapsed().as_secs_f64() * 1000.0)
}

fn cache_folder(root: &Path) -> PathBuf {
    root.join(".recognizer").join("cache")
}

pub fn history_path(root: &Path) -> PathBuf {
    cache_folder(root)
        .join(format!("scan-{LANGUAGE}"))
        .join("history.json")
}

fn number(item: &Value, name: &str) -> Option<f64> {
    item.get(name).filter(|value| value.is_number())?.as_f64()
}

fn read_all(root: &Path) -> Option<Vec<Value>> {
    let text = match fs::read_to_string(history_path(root)) {
        Ok(text) => text,
        Err(error) if error.kind() == ErrorKind::NotFound => return Some(Vec::new()),
        Err(_) => return None,
    };

    let document: Value = serde_json::from_str(&text).ok()?;
    let runs = document.get("runs")?.as_array()?;

    Some(
        runs.iter()
            .filter(|item| {
                item.get("key").is_some_and(Value::is_string)
                    && number(item, "ms").is_some()
                    && number(item, "units").is_some()
            })
            .cloned()
            .collect(),
    )
}

pub fn read_runs(root: &Path) -> Vec<Run> {
    read_all(root)
        .unwrap_or_default()
        .iter()
        .filter(|item| item.get("key").and_then(Value::as_str) == Some(KEY))
        .filter_map(|item| {
            Some(Run {
                ms: number(item, "ms")?,
                units: number(item, "units")?,
            })
        })
        .collect()
}

fn ensure_cache_ignore(root: &Path) -> std::io::Result<()> {
    let folder = cache_folder(root);

    fs::create_dir_all(&folder)?;

    match fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(folder.join(".gitignore"))
    {
        Ok(mut handle) => handle.write_all(b"*\n"),
        Err(error) if error.kind() == ErrorKind::AlreadyExists => Ok(()),
        Err(error) => Err(error),
    }
}

fn write_runs(root: &Path, runs: &[Value], staged: &Path) -> std::io::Result<()> {
    ensure_cache_ignore(root)?;

    let path = history_path(root);

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    fs::write(staged, json!({ "runs": runs }).to_string())?;
    fs::rename(staged, path)
}

pub fn record_run(root: &Path, ms: u64, units: u64) {
    let Some(mut runs) = read_all(root) else {
        return;
    };

    runs.push(json!({"key": KEY, "ms": ms, "units": units}));

    let from = runs.len().saturating_sub(KEPT_RUNS);
    let path = history_path(root);
    let staged = path.with_file_name(format!("history.json.{}.tmp", std::process::id()));

    if write_runs(root, &runs[from..], &staged).is_err() {
        let _ = fs::remove_file(&staged);
    }
}

pub fn scaled_estimate(runs: &[Run], total: usize, elapsed_ms: f64) -> Option<i64> {
    let mut rates: Vec<f64> = runs
        .iter()
        .filter(|run| run.units > 0.0)
        .map(|run| run.ms / run.units)
        .collect();

    if rates.is_empty() || total == 0 {
        return None;
    }

    rates.sort_by(f64::total_cmp);

    let middle = rates.len() / 2;
    let rate = if rates.len() % 2 == 1 {
        rates[middle]
    } else {
        (rates[middle - 1] + rates[middle]) / 2.0
    };
    let projected = rate * total as f64;

    if elapsed_ms > projected {
        None
    } else {
        Some((projected - elapsed_ms).trunc() as i64)
    }
}
