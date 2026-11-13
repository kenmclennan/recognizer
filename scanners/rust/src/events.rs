use serde_json::json;

pub const PREFIX: &str = "recognizer-event ";

const UNIT: &str = "files";

const MAX_PROGRESS_LINES: usize = 100;

pub struct Progress {
    total: usize,
    every: usize,
    done: usize,
    last: Option<usize>,
}

impl Default for Progress {
    fn default() -> Self {
        Self::new()
    }
}

impl Progress {
    pub fn new() -> Self {
        Progress {
            total: 0,
            every: 1,
            done: 0,
            last: None,
        }
    }

    pub fn start(&mut self, total: usize) {
        self.total = total;
        self.every = total.div_ceil(MAX_PROGRESS_LINES).max(1);
        self.done = 0;
        self.last = None;
        eprintln!(
            "{PREFIX}{}",
            json!({"event": "start", "total": total, "unit": UNIT})
        );
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

    fn report(&mut self) {
        self.last = Some(self.done);
        eprintln!(
            "{PREFIX}{}",
            json!({"event": "progress", "done": self.done, "total": self.total, "unit": UNIT})
        );
    }
}
