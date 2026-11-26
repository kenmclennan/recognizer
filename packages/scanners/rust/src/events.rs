use crate::history::{self, Clock, Run, MOVE_MS};
use serde_json::json;
use std::path::PathBuf;

pub const PREFIX: &str = "recognizer-event ";

const UNIT: &str = "files";

const MAX_PROGRESS_LINES: usize = 100;

pub struct Progress {
    total: usize,
    every: usize,
    done: usize,
    last: Option<usize>,
    root: Option<PathBuf>,
    runs: Vec<Run>,
    clock: Clock,
    began: f64,
    estimated: Option<i64>,
    said: bool,
    sink: Box<dyn FnMut(String)>,
}

impl Default for Progress {
    fn default() -> Self {
        Self::new()
    }
}

impl Progress {
    pub fn new() -> Self {
        Self::with(
            None,
            history::awake_clock(),
            Box::new(|line| eprintln!("{line}")),
        )
    }

    pub fn for_root(root: PathBuf) -> Self {
        Self::with(
            Some(root),
            history::awake_clock(),
            Box::new(|line| eprintln!("{line}")),
        )
    }

    pub fn with(root: Option<PathBuf>, clock: Clock, sink: Box<dyn FnMut(String)>) -> Self {
        let runs = root.as_deref().map(history::read_runs).unwrap_or_default();
        let began = clock();

        Progress {
            total: 0,
            every: 1,
            done: 0,
            last: None,
            root,
            runs,
            clock,
            began,
            estimated: None,
            said: false,
            sink,
        }
    }

    fn say(&mut self, event: serde_json::Value) {
        (self.sink)(format!("{PREFIX}{event}"));
    }

    pub fn start(&mut self, total: usize) {
        self.total = total;
        self.every = total.div_ceil(MAX_PROGRESS_LINES).max(1);
        self.done = 0;
        self.last = None;
        self.say(json!({"event": "start", "total": total, "unit": UNIT}));
        self.estimate(true);
    }

    pub fn advance(&mut self) {
        self.done += 1;

        if self.done.is_multiple_of(self.every) {
            self.report();
        }
    }

    pub fn finish(&mut self) {
        if self.last != Some(self.total) {
            self.done = self.total;
            self.report();
        }
    }

    pub fn complete(&mut self) {
        let Some(root) = &self.root else {
            return;
        };

        if self.total == 0 {
            return;
        }

        let ms = ((self.clock)() - self.began).round().max(0.0) as u64;

        history::record_run(root, ms, self.total as u64);
    }

    fn report(&mut self) {
        self.last = Some(self.done);
        self.say(
            json!({"event": "progress", "done": self.done, "total": self.total, "unit": UNIT}),
        );
        self.estimate(false);
    }

    fn estimate(&mut self, force: bool) {
        let elapsed = (self.clock)() - self.began;
        let value = history::scaled_estimate(&self.runs, self.total, elapsed);

        if self.said && !force {
            if value == self.estimated {
                return;
            }

            let moved = match (value, self.estimated) {
                (Some(now), Some(before)) => (now - before).abs() as f64 >= MOVE_MS,
                _ => true,
            };

            if !moved {
                return;
            }
        }

        self.estimated = value;
        self.said = true;
        self.say(json!({"event": "estimate", "remaining_ms": value}));
    }
}
