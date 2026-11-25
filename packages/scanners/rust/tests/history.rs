use std::cell::{Cell, RefCell};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::rc::Rc;

use recognizer_scan_rust::events::Progress;
use recognizer_scan_rust::history::history_path;
use serde_json::{json, Value};

const SEED: &str = r#"{"runs":[{"key":"run","ms":4000,"units":200}]}"#;

struct Rig {
    now: Rc<Cell<f64>>,
    lines: Rc<RefCell<Vec<String>>>,
    progress: Progress,
}

fn rig(root: &Path) -> Rig {
    let now = Rc::new(Cell::new(0.0));
    let lines = Rc::new(RefCell::new(Vec::new()));
    let clock_now = Rc::clone(&now);
    let sink_lines = Rc::clone(&lines);
    let progress = Progress::with(
        Some(root.to_path_buf()),
        Box::new(move || clock_now.get()),
        Box::new(move |line| sink_lines.borrow_mut().push(line)),
    );

    Rig {
        now,
        lines,
        progress,
    }
}

fn taken(lines: &Rc<RefCell<Vec<String>>>) -> Vec<Value> {
    lines
        .borrow_mut()
        .drain(..)
        .filter_map(|line| line.strip_prefix("recognizer-event ").map(str::to_string))
        .map(|json| serde_json::from_str(&json).unwrap())
        .collect()
}

fn estimates(events: Vec<Value>) -> Vec<Value> {
    events
        .into_iter()
        .filter(|event| event["event"] == "estimate")
        .collect()
}

fn estimate(remaining: Value) -> Value {
    json!({"event": "estimate", "remaining_ms": remaining})
}

fn seed(root: &Path, content: &str) -> PathBuf {
    let path = history_path(root);

    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(&path, content).unwrap();

    path
}

fn tree(count: usize) -> tempfile::TempDir {
    let directory = tempfile::tempdir().unwrap();

    for number in 0..count {
        fs::write(
            directory.path().join(format!("m{number}.rs")),
            "pub fn a() {}\n",
        )
        .unwrap();
    }

    directory
}

fn scan(root: &Path) -> std::process::Output {
    Command::new(env!("CARGO_BIN_EXE_recognizer-scan-rust"))
        .arg("run")
        .arg(root)
        .output()
        .unwrap()
}

fn events_of(output: &std::process::Output) -> Vec<Value> {
    String::from_utf8_lossy(&output.stderr)
        .lines()
        .filter_map(|line| line.strip_prefix("recognizer-event "))
        .map(|json| serde_json::from_str(json).unwrap())
        .collect()
}

fn stored(root: &Path) -> Vec<Value> {
    let document: Value =
        serde_json::from_str(&fs::read_to_string(history_path(root)).unwrap()).unwrap();

    document["runs"].as_array().unwrap().clone()
}

fn copy_tree(from: &Path, to: &Path) {
    fs::create_dir_all(to).unwrap();

    for entry in fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        let target = to.join(entry.file_name());

        if entry.file_name() == ".recognizer" {
            continue;
        }

        if entry.file_type().unwrap().is_dir() {
            copy_tree(&entry.path(), &target);
        } else {
            fs::copy(entry.path(), target).unwrap();
        }
    }
}

#[test]
fn no_history_reports_null_once_after_start() {
    let root = tree(3);
    let output = scan(root.path());
    let events = events_of(&output);
    let kinds: Vec<String> = events
        .iter()
        .map(|event| event["event"].as_str().unwrap().to_string())
        .collect();

    assert!(output.status.success());
    assert_eq!(kinds[..2], ["start", "estimate"]);
    assert_eq!(estimates(events), vec![estimate(Value::Null)]);
    assert!(kinds[2..].iter().all(|kind| kind == "progress"));
}

#[test]
fn history_reports_the_scaled_estimate() {
    let root = tree(100);

    seed(root.path(), SEED);

    let first = estimates(events_of(&scan(root.path())))[0]["remaining_ms"]
        .as_i64()
        .unwrap();

    assert!((0..=2000).contains(&first));

    for (now, wanted) in [
        (500.0, json!(1500)),
        (2000.0, json!(0)),
        (2001.0, Value::Null),
    ] {
        seed(root.path(), SEED);

        let mut held = rig(root.path());

        held.now.set(now);
        held.progress.start(100);

        assert_eq!(estimates(taken(&held.lines)), vec![estimate(wanted)]);
    }
}

#[test]
fn estimate_is_not_repeated_unchanged_and_moves_by_a_second() {
    let root = tempfile::tempdir().unwrap();

    seed(root.path(), SEED);

    let mut held = rig(root.path());

    held.progress.start(1000);

    assert_eq!(estimates(taken(&held.lines)), vec![estimate(json!(20000))]);

    let mut after = |now: f64| {
        held.now.set(now);

        for _ in 0..10 {
            held.progress.advance();
        }

        estimates(taken(&held.lines))
    };

    assert!(after(0.0).is_empty());
    assert!(after(999.0).is_empty());
    assert_eq!(after(1000.0), vec![estimate(json!(19000))]);
    assert!(after(1000.0).is_empty());
    assert_eq!(after(25000.0), vec![estimate(Value::Null)]);
}

#[test]
fn a_completed_run_is_recorded_and_a_failed_one_is_not() {
    let root = tree(3);

    assert!(scan(root.path()).status.success());

    let runs = stored(root.path());

    assert_eq!(runs.len(), 1);
    assert_eq!(runs[0]["key"], "run");
    assert_eq!(runs[0]["units"], 3);

    let before = fs::read_to_string(history_path(root.path())).unwrap();
    let missing = root.path().join("nowhere");

    assert_eq!(scan(&missing).status.code(), Some(2));
    assert_eq!(
        fs::read_to_string(history_path(root.path())).unwrap(),
        before
    );

    let empty = tempfile::tempdir().unwrap();
    let mut held = rig(empty.path());

    held.progress.start(0);
    held.progress.finish();
    held.progress.complete();

    assert!(!history_path(empty.path()).exists());
}

#[test]
fn history_keeps_the_last_five_runs() {
    let root = tempfile::tempdir().unwrap();

    for units in 1..=6 {
        let mut held = rig(root.path());

        held.progress.start(units);
        held.progress.complete();
    }

    let units: Vec<_> = stored(root.path())
        .iter()
        .map(|run| run["units"].as_u64().unwrap())
        .collect();

    assert_eq!(units, vec![2, 3, 4, 5, 6]);
}

#[test]
fn an_unreadable_history_reads_as_none_and_is_left_alone() {
    for content in [r#"{"runs": "#, r#"{"runs": 3}"#] {
        let root = tree(3);
        let path = seed(root.path(), content);

        assert_eq!(
            estimates(events_of(&scan(root.path()))),
            vec![estimate(Value::Null)]
        );
        assert_eq!(fs::read_to_string(path).unwrap(), content);
    }
}

#[test]
fn an_entry_with_a_boolean_is_skipped_while_a_valid_sibling_counts() {
    let root = tempfile::tempdir().unwrap();

    seed(
        root.path(),
        r#"{"runs":[{"key":"run","ms":true,"units":10},{"key":"run","ms":4000,"units":200}]}"#,
    );

    let mut held = rig(root.path());

    held.now.set(500.0);
    held.progress.start(100);

    assert_eq!(estimates(taken(&held.lines)), vec![estimate(json!(1500))]);
}

#[test]
fn a_write_that_fails_does_not_fail_the_scan() {
    let root = tree(3);

    fs::create_dir(root.path().join(".recognizer")).unwrap();
    fs::write(root.path().join(".recognizer").join("cache"), "in the way").unwrap();

    let output = scan(root.path());
    let document: Value = serde_json::from_slice(&output.stdout).unwrap();

    assert!(output.status.success());
    assert!(!document["modules"].as_array().unwrap().is_empty());
}

#[test]
fn the_cache_folder_ignores_itself() {
    let root = tree(2);

    scan(root.path());

    let ignore = root.path().join(".recognizer/cache/.gitignore");

    assert_eq!(fs::read_to_string(&ignore).unwrap().trim(), "*");

    fs::write(&ignore, "kept\n").unwrap();
    scan(root.path());

    assert_eq!(fs::read_to_string(&ignore).unwrap(), "kept\n");
}

#[test]
fn history_clock_is_the_awake_clock_and_reads_no_wall_clock() {
    let source =
        fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/src/history.rs")).unwrap();

    assert!(source.contains("Instant::now()"));

    for banned in [
        "Date.now",
        "new Date",
        "performance.timeOrigin",
        "SystemTime",
    ] {
        assert!(!source.contains(banned), "{banned}");
    }
}

#[test]
fn a_wall_clock_jump_does_not_change_a_recorded_run_or_the_estimate() {
    let root = tempfile::tempdir().unwrap();

    seed(root.path(), SEED);

    let mut held = rig(root.path());

    held.now.set(500.0);
    held.progress.start(100);

    assert_eq!(estimates(taken(&held.lines)), vec![estimate(json!(1500))]);

    held.now.set(1000.0);
    held.progress.complete();

    let last = stored(root.path()).pop().unwrap();

    assert_eq!(last, json!({"key": "run", "ms": 1000, "units": 100}));
}

#[test]
fn a_run_over_the_committed_fixture_reports_a_null_estimate_then_records() {
    let root = tempfile::tempdir().unwrap();
    let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../fixtures/rust/sample");

    copy_tree(&fixture, root.path());

    let output = scan(root.path());
    let events = events_of(&output);
    let total = events[0]["total"].clone();

    assert!(output.status.success());
    assert_eq!(estimates(events), vec![estimate(Value::Null)]);
    assert_eq!(
        stored(root.path())
            .iter()
            .map(|run| run["units"].clone())
            .collect::<Vec<_>>(),
        vec![total]
    );
}
