use std::collections::HashMap;
use std::io::{Read, Write};
use std::ops::Deref;
use std::path::Path;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{mpsc, Arc, Mutex, MutexGuard};
use std::time::Duration;

use serde_json::{json, Value};

use crate::scan_run::{kill_group, schedule_backstop, STOP_BACKSTOP};
use crate::tool_runner::{ToolFault, ToolRunner};

pub const SERVICE_EVENT: &str = "core-event";
pub const STOP_FALLBACK: Duration = Duration::from_secs(15);

const STDERR_CHARS: usize = 8192;
const STDERR_TAIL_BYTES: usize = 4 * STDERR_CHARS;
const STARTED_BY: &str = "RECOGNIZER_STARTED_BY";
const ALREADY_RUNNING: &str = "a scan is already running";
const SETUP_ALREADY_RUNNING: &str = "a setup check or apply is already running";

pub type Launcher = Box<dyn Fn() -> Result<Command, Value> + Send + Sync>;

pub trait Sink: Send + Sync {
    fn emit(&self, label: &str, item: &Value);
}

pub trait Baselines: Send + Sync {
    fn take(&self, label: &str, repository: &str);
    fn clear(&self, label: &str);
}

pub trait ScanStatus {
    fn refusal(&self, repository: &Path) -> Option<String>;
}

pub type Callback = Arc<dyn Fn(&Value) + Send + Sync>;

fn locked<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|error| error.into_inner())
}

pub fn unavailable(kind: &str, extra: Value) -> Value {
    let mut body = json!({ "kind": kind });

    if let (Some(target), Some(source)) = (body.as_object_mut(), extra.as_object()) {
        for (key, value) in source {
            target.insert(key.clone(), value.clone());
        }
    }

    json!({ "unavailable": body })
}

fn fault_gap(fault: &ToolFault, needs: Vec<String>) -> Value {
    json!({ "id": fault.gap_id(), "line": fault.message(), "needs": needs })
}

pub fn gaps_unavailable(fault: &ToolFault) -> Value {
    unavailable(
        "gaps",
        json!({ "gaps": [fault_gap(fault, vec!["scan".to_string()])] }),
    )
}

pub fn command_unavailable(fault: &ToolFault) -> Value {
    match fault {
        ToolFault::Missing { .. } => unavailable("missing", json!({ "hint": fault.message() })),
        other => unavailable("refused", json!({ "reason": other.message() })),
    }
}

pub fn runner_launcher<R>(runner: R, command: &str) -> Launcher
where
    R: Deref<Target = ToolRunner> + Send + Sync + 'static,
{
    let command = command.to_string();

    Box::new(move || {
        runner
            .check_all()
            .map_err(|fault| gaps_unavailable(&fault))?;

        runner
            .command(&command)
            .map_err(|fault| command_unavailable(&fault))
    })
}

fn needs_of(args: &Value) -> Vec<String> {
    let mut names: Vec<String> = args
        .get("sense")
        .and_then(Value::as_array)
        .map(|list| {
            list.iter()
                .filter_map(|name| name.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();

    if args.get("describe").is_some_and(|describe| {
        describe.as_str().is_some() || describe.as_bool().is_some_and(|on| on)
    }) {
        names.push("describe".to_string());
    }

    if names.is_empty() {
        names.push("scan".to_string());
    }

    names
}

fn with_needs(reply: Value, args: &Value) -> Value {
    let mut reply = reply;

    if let Some(gaps) = reply
        .pointer_mut("/unavailable/gaps")
        .and_then(Value::as_array_mut)
    {
        for gap in gaps {
            gap["needs"] = json!(needs_of(args));
        }
    }

    reply
}

pub fn bound_stderr(bytes: &[u8]) -> String {
    let text = String::from_utf8_lossy(bytes);
    let trimmed = text.trim_end();
    let count = trimmed.chars().count();

    if count <= STDERR_CHARS {
        return trimmed.to_string();
    }

    trimmed.chars().skip(count - STDERR_CHARS).collect()
}

fn read_tail_into(mut source: impl Read, shared: &Mutex<Vec<u8>>) {
    let mut chunk = [0u8; 4096];

    loop {
        match source.read(&mut chunk) {
            Ok(0) | Err(_) => break,
            Ok(count) => {
                let mut tail = locked(shared);

                tail.extend_from_slice(&chunk[..count]);

                if tail.len() > STDERR_TAIL_BYTES {
                    let excess = tail.len() - STDERR_TAIL_BYTES;

                    tail.drain(..excess);
                }
            }
        }
    }
}

pub struct GroupHandle {
    state: Mutex<(Option<u32>, bool)>,
    backstop: Duration,
}

impl Default for GroupHandle {
    fn default() -> Self {
        Self::with_backstop(STOP_BACKSTOP)
    }
}

impl GroupHandle {
    pub fn with_backstop(backstop: Duration) -> Self {
        GroupHandle {
            state: Mutex::new((None, false)),
            backstop,
        }
    }

    pub fn started(&self, pid: u32) {
        let mut state = locked(&self.state);

        state.0 = Some(pid);

        if state.1 {
            kill_group(pid);
            schedule_backstop(pid, self.backstop);
        }
    }

    pub fn stop(&self) {
        let mut state = locked(&self.state);

        state.1 = true;

        if let Some(pid) = state.0 {
            kill_group(pid);
            schedule_backstop(pid, self.backstop);
        }
    }

    pub fn stopped(&self) -> bool {
        locked(&self.state).1
    }
}

#[derive(Default)]
struct Run {
    scan: Option<String>,
    stopped: bool,
}

#[derive(Default)]
pub struct ScanRuns {
    runs: Mutex<HashMap<String, Run>>,
}

impl ScanRuns {
    fn lock(&self) -> MutexGuard<'_, HashMap<String, Run>> {
        locked(&self.runs)
    }

    pub fn begin(&self, label: &str) -> Result<(), String> {
        let mut runs = self.lock();

        if runs.contains_key(label) {
            return Err(ALREADY_RUNNING.to_string());
        }

        runs.insert(label.to_string(), Run::default());

        Ok(())
    }

    fn attach(&self, label: &str, scan: &str) -> bool {
        let mut runs = self.lock();

        match runs.get_mut(label) {
            Some(run) => {
                run.scan = Some(scan.to_string());

                run.stopped
            }
            None => false,
        }
    }

    pub fn stop(&self, label: &str) -> Option<String> {
        let mut runs = self.lock();
        let run = runs.get_mut(label)?;

        run.stopped = true;

        run.scan.clone()
    }

    pub fn finish(&self, label: &str) -> bool {
        self.lock().remove(label).is_some_and(|run| run.stopped)
    }

    pub fn running(&self, label: &str) -> bool {
        self.lock().contains_key(label)
    }

    pub fn in_progress(&self, label: &str) -> bool {
        self.lock().get(label).is_some_and(|run| !run.stopped)
    }

    pub fn in_progress_labels(&self) -> Vec<String> {
        self.lock()
            .iter()
            .filter(|(_, run)| !run.stopped)
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

#[derive(Default)]
struct SetupEntry {
    setup: Option<String>,
    stopped: bool,
}

#[derive(Default)]
pub struct SetupLedger {
    entries: Mutex<HashMap<String, SetupEntry>>,
    reads: Mutex<HashMap<String, SetupEntry>>,
    next_read: AtomicUsize,
}

impl SetupLedger {
    fn lock(&self) -> MutexGuard<'_, HashMap<String, SetupEntry>> {
        locked(&self.entries)
    }

    fn lock_reads(&self) -> MutexGuard<'_, HashMap<String, SetupEntry>> {
        locked(&self.reads)
    }

    pub fn begin(&self, label: &str) -> Result<(), String> {
        let mut entries = self.lock();

        if entries.contains_key(label) {
            return Err(SETUP_ALREADY_RUNNING.to_string());
        }

        entries.insert(label.to_string(), SetupEntry::default());

        Ok(())
    }

    pub fn begin_read(&self, label: &str) -> String {
        let number = self.next_read.fetch_add(1, Ordering::Relaxed);
        let key = format!("{label}#read-{number}");

        self.lock_reads().insert(key.clone(), SetupEntry::default());

        key
    }

    fn attach(&self, key: &str, setup: &str) -> bool {
        let mut entries = self.lock();

        if let Some(entry) = entries.get_mut(key) {
            entry.setup = Some(setup.to_string());

            return entry.stopped;
        }

        drop(entries);

        match self.lock_reads().get_mut(key) {
            Some(entry) => {
                entry.setup = Some(setup.to_string());

                entry.stopped
            }
            None => false,
        }
    }

    pub fn stop(&self, label: &str) -> Vec<String> {
        let prefix = format!("{label}#read-");
        let mut setups = Vec::new();

        if let Some(entry) = self.lock().get_mut(label) {
            entry.stopped = true;
            setups.extend(entry.setup.clone());
        }

        for (key, entry) in self.lock_reads().iter_mut() {
            if key.starts_with(&prefix) {
                entry.stopped = true;
                setups.extend(entry.setup.clone());
            }
        }

        setups
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
        self.lock().get(label).is_some_and(|entry| entry.stopped)
    }

    pub fn finish(&self, key: &str) -> bool {
        if let Some(entry) = self.lock().remove(key) {
            return entry.stopped;
        }

        self.lock_reads()
            .remove(key)
            .is_some_and(|entry| entry.stopped)
    }

    pub fn running(&self, label: &str) -> bool {
        self.lock().contains_key(label)
    }

    pub fn running_count(&self) -> usize {
        self.lock().len()
    }
}

#[derive(Clone)]
enum Owner {
    Window(String),
    Callback(Callback),
}

#[derive(Clone)]
enum Track {
    Scan(String),
    Watch(Owner, String),
    Setup(String, String, Callback),
}

struct Pending {
    reply: mpsc::Sender<Value>,
    track: Option<Track>,
}

#[derive(Clone)]
enum Kind {
    Scan,
    Watch,
    Setup(String, String),
}

struct Stream {
    owner: Owner,
    kind: Kind,
}

struct Live {
    generation: u64,
    stdin: ChildStdin,
    handle: Arc<GroupHandle>,
    stderr: Arc<Mutex<Vec<u8>>>,
}

#[derive(Default)]
struct State {
    live: Option<Live>,
    generation: u64,
    next: i64,
    pending: HashMap<i64, Pending>,
    streams: HashMap<String, Stream>,
    watches: HashMap<String, String>,
}

struct Inner {
    launcher: Launcher,
    sink: Arc<dyn Sink>,
    baselines: Arc<dyn Baselines>,
    runs: ScanRuns,
    setups: SetupLedger,
    state: Mutex<State>,
    backstop: Duration,
    fallback: Duration,
}

#[derive(Clone)]
pub struct CoreClient {
    inner: Arc<Inner>,
}

enum Action {
    Emit(String, Value),
    Call(Callback, Value),
    ClearBaseline(String),
}

impl CoreClient {
    pub fn new(launcher: Launcher, sink: Arc<dyn Sink>, baselines: Arc<dyn Baselines>) -> Self {
        Self::with_timing(launcher, sink, baselines, STOP_BACKSTOP, STOP_FALLBACK)
    }

    pub fn with_timing(
        launcher: Launcher,
        sink: Arc<dyn Sink>,
        baselines: Arc<dyn Baselines>,
        backstop: Duration,
        fallback: Duration,
    ) -> Self {
        CoreClient {
            inner: Arc::new(Inner {
                launcher,
                sink,
                baselines,
                runs: ScanRuns::default(),
                setups: SetupLedger::default(),
                state: Mutex::default(),
                backstop,
                fallback,
            }),
        }
    }

    pub fn runs(&self) -> &ScanRuns {
        &self.inner.runs
    }

    pub fn setups(&self) -> &SetupLedger {
        &self.inner.setups
    }

    pub fn setups_running(&self) -> usize {
        self.inner.setups.running_count()
    }

    pub fn run_setup(
        &self,
        label: &str,
        repository: &Path,
        action: &str,
        args: Value,
        on_event: impl Fn(String),
    ) -> Value {
        let counted = action != "survey";
        let key = if counted {
            if let Err(reason) = self.inner.setups.begin(label) {
                return json!({ "status": "refused", "reason": reason });
            }

            label.to_string()
        } else {
            self.inner.setups.begin_read(label)
        };
        let mut args = match args {
            Value::Object(map) => Value::Object(map),
            _ => json!({}),
        };

        args["repository"] = json!(repository.display().to_string());
        args["action"] = json!(action);

        let (sender, receiver) = mpsc::channel::<Value>();
        let sender = Mutex::new(sender);
        let callback: Callback = Arc::new(move |item| {
            let _ = locked(&sender).send(item.clone());
        });
        let reply = self.request(
            "setup.start",
            args,
            Some(Track::Setup(key.clone(), action.to_string(), callback)),
        );
        let Some(setup) = reply.get("ok").and_then(Value::as_str).map(str::to_string) else {
            self.inner.setups.finish(&key);

            return setup_failure(action, &setup_reason(&reply));
        };

        if self.inner.setups.attach(&key, &setup) {
            self.send_stop_setup(&setup);
        }

        loop {
            let Ok(item) = receiver.recv() else {
                return setup_failure(action, "the service exited");
            };

            if let Some(outcome) = item.get("outcome") {
                return outcome.clone();
            }

            match item.get("event") {
                Some(Value::String(line)) => on_event(line.clone()),
                Some(other) => on_event(other.to_string()),
                None => {}
            }
        }
    }

    pub fn stop_setup(&self, label: &str) {
        for setup in self.inner.setups.stop(label) {
            self.arm_fallback(&setup);
            self.send_stop_setup(&setup);
        }
    }

    fn send_stop_setup(&self, setup: &str) {
        let (sender, _) = mpsc::channel();
        let mut state = locked(&self.inner.state);

        let _ = self.write(
            &mut state,
            "setup.stop",
            json!({ "setup": setup }),
            sender,
            None,
        );
    }

    pub fn call(
        &self,
        label: &str,
        repository: Option<&Path>,
        op: &str,
        args: Value,
    ) -> Result<Value, String> {
        let mut args = match args {
            Value::Object(map) => Value::Object(map),
            Value::Null => json!({}),
            _ => return Err("the arguments are not an object".to_string()),
        };

        match repository {
            Some(path) => args["repository"] = json!(path.display().to_string()),
            None => {
                if let Some(map) = args.as_object_mut() {
                    map.remove("repository");
                }
            }
        }

        Ok(match op {
            "scan.start" => self.start_scan(label, args),
            "scan.stop" => self.stop_one(label, args),
            "scan.watch" => self.watch_for(label, args),
            "scan.unwatch" => {
                locked(&self.inner.state).watches.remove(label);
                self.request(op, args, None)
            }
            _ => self.request(op, args, None),
        })
    }

    fn start_scan(&self, label: &str, args: Value) -> Value {
        if let Err(error) = self.inner.runs.begin(label) {
            return json!({ "error": error });
        }

        if let Some(repository) = args.get("repository").and_then(Value::as_str) {
            self.inner.baselines.take(label, repository);
        }

        let reply = self.request("scan.start", args, Some(Track::Scan(label.to_string())));
        let started = reply.get("ok").and_then(Value::as_str).map(str::to_string);

        match started {
            Some(scan) => {
                if self.inner.runs.attach(label, &scan) {
                    self.send_stop_one(&scan);
                }
            }
            None => {
                self.inner.runs.finish(label);
                self.inner.baselines.clear(label);
            }
        }

        reply
    }

    fn stop_one(&self, label: &str, args: Value) -> Value {
        if let Some(scan) = self.inner.runs.stop(label) {
            self.arm_fallback(&scan);
        }

        self.request("scan.stop", args, None)
    }

    fn watch_for(&self, label: &str, args: Value) -> Value {
        let repository = args
            .get("repository")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();

        self.request(
            "scan.watch",
            args,
            Some(Track::Watch(Owner::Window(label.to_string()), repository)),
        )
    }

    fn request(&self, op: &str, args: Value, track: Option<Track>) -> Value {
        let (sender, receiver) = mpsc::channel();
        let needs = args.clone();

        {
            let mut state = locked(&self.inner.state);

            if let Err(error) = self.ensure(&mut state) {
                return with_needs(error, &needs);
            }

            if let Err(error) = self.write(&mut state, op, args, sender, track) {
                return error;
            }
        }

        match receiver.recv() {
            Ok(reply) => with_needs(reply, &needs),
            Err(_) => unavailable("exited", json!({ "status": null, "stderr": "" })),
        }
    }

    pub fn status(&self, repository: &Path) -> Option<Value> {
        let reply = self.request(
            "scan.status",
            json!({ "repository": repository.display().to_string() }),
            None,
        );

        reply.get("ok").cloned()
    }

    pub fn watch(
        &self,
        repository: &Path,
        on_item: impl Fn(&Value) + Send + Sync + 'static,
    ) -> Option<String> {
        let callback: Callback = Arc::new(on_item);
        let reply = self.request(
            "scan.watch",
            json!({ "repository": repository.display().to_string() }),
            Some(Track::Watch(
                Owner::Callback(callback),
                repository.display().to_string(),
            )),
        );

        reply.get("ok").and_then(Value::as_str).map(str::to_string)
    }

    pub fn unwatch(&self, watch: &str) {
        let mut state = locked(&self.inner.state);

        state.streams.remove(watch);

        let _ = self.send_line(&mut state, "scan.unwatch", json!({ "watch": watch }));
    }

    fn ensure(&self, state: &mut State) -> Result<(), Value> {
        if state.live.is_some() {
            return Ok(());
        }

        let mut command = (self.inner.launcher)()?;

        command
            .arg("serve")
            .env(STARTED_BY, "app")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;

            command.process_group(0);
        }

        let mut child = command.spawn().map_err(|_| {
            command_unavailable(&ToolFault::Missing {
                tool: "recognizer".to_string(),
            })
        })?;

        state.generation += 1;

        let generation = state.generation;
        let handle = Arc::new(GroupHandle::with_backstop(self.inner.backstop));
        let stderr = Arc::new(Mutex::new(Vec::new()));
        let stdin = child.stdin.take();
        let stdout = child.stdout.take();
        let error_pipe = child.stderr.take();

        handle.started(child.id());

        let (Some(stdin), Some(stdout)) = (stdin, stdout) else {
            let _ = child.kill();
            let _ = child.wait();

            return Err(unavailable(
                "refused",
                json!({ "reason": "the service has no standard streams" }),
            ));
        };

        let collector = error_pipe.map(|pipe| {
            let shared = Arc::clone(&stderr);

            std::thread::spawn(move || read_tail_into(pipe, &shared))
        });
        let inner = Arc::clone(&self.inner);
        let tail = Arc::clone(&stderr);

        std::thread::Builder::new()
            .name("core-reader".to_string())
            .spawn(move || read_replies(inner, generation, stdout, child, collector, tail))
            .map_err(|error| unavailable("refused", json!({ "reason": error.to_string() })))?;

        state.live = Some(Live {
            generation,
            stdin,
            handle,
            stderr,
        });

        let watches: Vec<(String, String)> = state
            .watches
            .iter()
            .map(|(label, repository)| (label.clone(), repository.clone()))
            .collect();

        for (label, repository) in watches {
            let (sender, _) = mpsc::channel();
            let _ = self.write(
                state,
                "scan.watch",
                json!({ "repository": repository }),
                sender,
                Some(Track::Watch(Owner::Window(label), repository)),
            );
        }

        Ok(())
    }

    fn exited(&self, state: &State) -> Value {
        let stderr = state
            .live
            .as_ref()
            .map(|live| bound_stderr(&locked(&live.stderr)))
            .unwrap_or_default();

        unavailable("exited", json!({ "status": null, "stderr": stderr }))
    }

    fn send_line(&self, state: &mut State, op: &str, args: Value) -> Result<i64, Value> {
        state.next += 1;

        let id = state.next;
        let line = format!("{}\n", json!({ "id": id, "op": op, "args": args }));
        let failed = match state.live.as_mut() {
            Some(live) => live
                .stdin
                .write_all(line.as_bytes())
                .and_then(|_| live.stdin.flush())
                .is_err(),
            None => true,
        };

        if failed {
            return Err(self.exited(state));
        }

        Ok(id)
    }

    fn write(
        &self,
        state: &mut State,
        op: &str,
        args: Value,
        reply: mpsc::Sender<Value>,
        track: Option<Track>,
    ) -> Result<(), Value> {
        let next = state.next + 1;

        state.pending.insert(next, Pending { reply, track });

        match self.send_line(state, op, args) {
            Ok(_) => Ok(()),
            Err(error) => {
                state.pending.remove(&next);

                Err(error)
            }
        }
    }

    fn send_stop_one(&self, scan: &str) {
        let (sender, _) = mpsc::channel();
        let mut state = locked(&self.inner.state);

        let _ = self.write(
            &mut state,
            "scan.stop",
            json!({ "scan": scan }),
            sender,
            None,
        );
    }

    fn arm_fallback(&self, scan: &str) {
        let (generation, delay) = {
            let state = locked(&self.inner.state);

            (
                state.live.as_ref().map(|live| live.generation),
                self.inner.fallback,
            )
        };
        let Some(generation) = generation else {
            return;
        };
        let inner = Arc::clone(&self.inner);
        let scan = scan.to_string();

        std::thread::spawn(move || {
            std::thread::sleep(delay);

            let state = locked(&inner.state);

            if let Some(live) = state
                .live
                .as_ref()
                .filter(|live| live.generation == generation)
            {
                if state.streams.contains_key(&scan) {
                    live.handle.stop();
                }
            }
        });
    }

    pub fn stop_window(&self, label: &str) {
        self.stop_setup(label);

        if let Some(scan) = self.inner.runs.stop(label) {
            self.arm_fallback(&scan);
            self.send_stop_one(&scan);
        }
    }

    pub fn window_closed(&self, label: &str) {
        self.stop_window(label);

        let watches: Vec<String> = {
            let mut state = locked(&self.inner.state);

            state.watches.remove(label);

            state
                .streams
                .iter()
                .filter(|(_, stream)| {
                    matches!(stream.kind, Kind::Watch)
                        && matches!(&stream.owner, Owner::Window(owner) if owner == label)
                })
                .map(|(id, _)| id.clone())
                .collect()
        };

        for watch in watches {
            self.unwatch(&watch);
        }
    }

    pub fn shutdown(&self, repositories: &[std::path::PathBuf]) {
        let mut state = locked(&self.inner.state);

        if state.live.is_none() {
            return;
        }

        for repository in repositories {
            let (sender, _) = mpsc::channel();
            let _ = self.write(
                &mut state,
                "scan.stop",
                json!({ "repository": repository.display().to_string(), "owner": "app" }),
                sender,
                None,
            );
        }

        if let Some(live) = state.live.as_ref() {
            live.handle.stop();
        }
    }

    pub fn in_progress(&self, label: &str) -> bool {
        self.inner.runs.in_progress(label)
    }

    pub fn in_progress_labels(&self) -> Vec<String> {
        self.inner.runs.in_progress_labels()
    }
}

impl ScanStatus for CoreClient {
    fn refusal(&self, repository: &Path) -> Option<String> {
        let status = self.status(repository)?;

        if status.get("running").and_then(Value::as_bool) != Some(true) {
            return None;
        }

        Some(
            status
                .get("refusal")
                .and_then(Value::as_str)
                .unwrap_or("a scan is already running")
                .to_string(),
        )
    }
}

fn crashed(message: &str) -> Value {
    json!({
        "status": "failed",
        "reason": "crashed",
        "error": { "name": "Error", "message": message }
    })
}

fn setup_failure(action: &str, reason: &str) -> Value {
    match action {
        "survey" => json!({ "status": "unavailable", "reason": reason }),
        "recommend" => json!({
            "status": "failed",
            "reason": reason,
            "subtype": null,
            "costUsd": null,
            "durationMs": null
        }),
        _ => json!({ "status": "failed", "reason": reason }),
    }
}

fn setup_reason(reply: &Value) -> String {
    ["/unavailable/hint", "/unavailable/reason", "/error"]
        .iter()
        .find_map(|pointer| reply.pointer(pointer).and_then(Value::as_str))
        .unwrap_or("the service could not start the setup")
        .to_string()
}

fn read_replies(
    inner: Arc<Inner>,
    generation: u64,
    stdout: impl Read,
    mut child: Child,
    collector: Option<std::thread::JoinHandle<()>>,
    stderr: Arc<Mutex<Vec<u8>>>,
) {
    let reader = std::io::BufReader::new(stdout);

    for line in std::io::BufRead::lines(reader).map_while(Result::ok) {
        let Ok(item) = serde_json::from_str::<Value>(&line) else {
            continue;
        };

        if !item.is_object() {
            continue;
        }

        handle_item(&inner, item);
    }

    let status = child.wait().ok();

    if let Some(collector) = collector {
        let _ = collector.join();
    }

    let exited = unavailable(
        "exited",
        json!({
            "status": status.and_then(|status| status.code()),
            "detail": status.map(|status| status.to_string()),
            "stderr": bound_stderr(&locked(&stderr)),
        }),
    );
    let message = exited
        .pointer("/unavailable/detail")
        .and_then(Value::as_str)
        .map(|detail| format!("the service exited: {detail}"))
        .unwrap_or_else(|| "the service exited".to_string());
    let mut actions = Vec::new();
    let mut replies = Vec::new();

    {
        let mut state = locked(&inner.state);

        if state.live.as_ref().map(|live| live.generation) == Some(generation) {
            state.live = None;
        }

        for (_, pending) in state.pending.drain() {
            replies.push(pending.reply);
        }

        let scans: Vec<(String, String)> = state
            .streams
            .iter()
            .filter_map(|(id, stream)| match (&stream.kind, &stream.owner) {
                (Kind::Scan, Owner::Window(label)) => Some((id.clone(), label.clone())),
                _ => None,
            })
            .collect();
        let setups: Vec<(String, String, String, Callback)> = state
            .streams
            .iter()
            .filter_map(|(id, stream)| match (&stream.kind, &stream.owner) {
                (Kind::Setup(key, action), Owner::Callback(callback)) => {
                    Some((id.clone(), key.clone(), action.clone(), callback.clone()))
                }
                _ => None,
            })
            .collect();

        state.streams.clear();

        for (id, label) in scans {
            inner.runs.finish(&label);
            actions.push(Action::Emit(
                label.clone(),
                json!({ "stream": id, "outcome": crashed(&message) }),
            ));
            actions.push(Action::ClearBaseline(label));
        }

        for (id, key, action, callback) in setups {
            inner.setups.finish(&key);
            actions.push(Action::Call(
                callback,
                json!({ "stream": id, "outcome": setup_failure(&action, &message) }),
            ));
        }
    }

    for reply in replies {
        let _ = reply.send(exited.clone());
    }

    run_actions(&inner, actions);
}

fn run_actions(inner: &Inner, actions: Vec<Action>) {
    for action in actions {
        match action {
            Action::Emit(label, item) => inner.sink.emit(&label, &item),
            Action::Call(callback, item) => callback(&item),
            Action::ClearBaseline(label) => inner.baselines.clear(&label),
        }
    }
}

fn handle_item(inner: &Arc<Inner>, item: Value) {
    if let Some(stream) = item.get("stream").and_then(Value::as_str) {
        let stream = stream.to_string();
        let mut actions = Vec::new();

        {
            let mut state = locked(&inner.state);
            let ended = item.get("outcome").is_some();
            let Some(found) = state.streams.get(&stream) else {
                return;
            };
            let owner = found.owner.clone();
            let kind = found.kind.clone();

            if ended {
                state.streams.remove(&stream);
            }

            match owner {
                Owner::Window(label) => {
                    if ended {
                        inner.runs.finish(&label);

                        let status = item.pointer("/outcome/status").and_then(Value::as_str);
                        let reason = item.pointer("/outcome/reason").and_then(Value::as_str);

                        if status == Some("refused") && reason == Some("lock") {
                            actions.push(Action::ClearBaseline(label.clone()));
                        }
                    }

                    actions.insert(0, Action::Emit(label, item));
                }
                Owner::Callback(callback) => {
                    if let (true, Kind::Setup(key, _)) = (ended, &kind) {
                        inner.setups.finish(key);
                    }

                    actions.push(Action::Call(callback, item));
                }
            }
        }

        run_actions(inner, actions);

        return;
    }

    let Some(id) = item.get("id").and_then(Value::as_i64) else {
        return;
    };
    let mut reply = item;
    let pending = {
        let mut state = locked(&inner.state);
        let pending = state.pending.remove(&id);

        if let (Some(pending), Some(ok)) = (&pending, reply.get("ok")) {
            if let (Some(track), Some(stream)) = (&pending.track, ok.as_str()) {
                match track {
                    Track::Scan(label) => {
                        state.streams.insert(
                            stream.to_string(),
                            Stream {
                                owner: Owner::Window(label.clone()),
                                kind: Kind::Scan,
                            },
                        );
                    }
                    Track::Setup(key, action, callback) => {
                        state.streams.insert(
                            stream.to_string(),
                            Stream {
                                owner: Owner::Callback(callback.clone()),
                                kind: Kind::Setup(key.clone(), action.clone()),
                            },
                        );
                    }
                    Track::Watch(owner, repository) => {
                        if let Owner::Window(label) = owner {
                            state.watches.insert(label.clone(), repository.clone());
                        }

                        state.streams.insert(
                            stream.to_string(),
                            Stream {
                                owner: owner.clone(),
                                kind: Kind::Watch,
                            },
                        );
                    }
                }
            }
        }

        pending
    };

    if let Some(map) = reply.as_object_mut() {
        map.remove("id");
    }

    if let Some(pending) = pending {
        let _ = pending.reply.send(reply);
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;
    use std::fs;
    use std::path::PathBuf;
    use std::process::Command;
    use std::time::Instant;

    use tempfile::TempDir;

    use super::*;
    use crate::tool_runner::tests::{
        bundled_runner, fake_command, fake_commands, runner_with, runs_of,
    };

    fn read_tail(source: impl Read) -> Vec<u8> {
        let shared = Mutex::new(Vec::new());

        read_tail_into(source, &shared);

        shared
            .into_inner()
            .unwrap_or_else(|error| error.into_inner())
    }

    #[derive(Default)]
    struct Collected(Mutex<Vec<(String, Value)>>);

    impl Sink for Collected {
        fn emit(&self, label: &str, item: &Value) {
            locked(&self.0).push((label.to_string(), item.clone()));
        }
    }

    #[derive(Default)]
    struct Held(Mutex<HashSet<String>>);

    impl Baselines for Held {
        fn take(&self, label: &str, _: &str) {
            locked(&self.0).insert(label.to_string());
        }

        fn clear(&self, label: &str) {
            locked(&self.0).remove(label);
        }
    }

    const ECHO: &str = r#"
while read -r line; do
  id=${line#*\"id\":}
  id=${id%%,*}
  echo "$line" >> "$LOG"
  case "$line" in
    *'"op":"scan.start"'*)
      echo "{\"id\":$id,\"ok\":\"s1\"}"
      echo '{"stream":"s1","event":{"kind":"phase"}}'
      echo "{\"stream\":\"s1\",\"outcome\":$OUTCOME}"
      ;;
    *'"op":"scan.watch"'*) echo "{\"id\":$id,\"ok\":\"w1\"}" ;;
    *die*) exit 3 ;;
    *) echo "{\"id\":$id,\"ok\":\"pong\"}" ;;
  esac
done
"#;

    fn script_launcher(
        dir: &Path,
        body: &str,
        outcome: &str,
    ) -> (Launcher, PathBuf, Arc<Mutex<u32>>) {
        let log = dir.join("log");
        let spawns = Arc::new(Mutex::new(0u32));
        let counted = Arc::clone(&spawns);
        let body = body.to_string();
        let outcome = outcome.to_string();
        let log_path = log.clone();

        let launcher: Launcher = Box::new(move || {
            *locked(&counted) += 1;

            let mut command = Command::new("/bin/sh");

            command
                .arg("-c")
                .arg(&body)
                .env("LOG", &log_path)
                .env("OUTCOME", &outcome);

            Ok(command)
        });

        (launcher, log, spawns)
    }

    fn client(
        dir: &Path,
        body: &str,
        outcome: &str,
    ) -> (
        CoreClient,
        Arc<Collected>,
        Arc<Held>,
        PathBuf,
        Arc<Mutex<u32>>,
    ) {
        let (launcher, log, spawns) = script_launcher(dir, body, outcome);
        let sink = Arc::new(Collected::default());
        let baselines = Arc::new(Held::default());
        let client = CoreClient::with_timing(
            launcher,
            sink.clone(),
            baselines.clone(),
            Duration::from_millis(300),
            Duration::from_millis(200),
        );

        (client, sink, baselines, log, spawns)
    }

    fn lines_of(log: &Path) -> Vec<Value> {
        fs::read_to_string(log)
            .unwrap_or_default()
            .lines()
            .filter_map(|line| serde_json::from_str(line).ok())
            .collect()
    }

    fn wait_until(what: &str, check: impl Fn() -> bool) {
        let deadline = Instant::now() + Duration::from_secs(10);

        while !check() {
            assert!(Instant::now() < deadline, "timed out waiting for {what}");
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    #[test]
    fn a_call_is_written_as_one_line_and_its_reply_returned() {
        let dir = TempDir::new().unwrap();
        let (client, _, _, log, _) = client(dir.path(), ECHO, "{}");
        let reply = client
            .call(
                "w-1",
                Some(dir.path()),
                "scan.plan",
                json!({ "mode": "bring" }),
            )
            .unwrap();

        assert_eq!(reply, json!({ "ok": "pong" }));

        let written = lines_of(&log);

        assert_eq!(written.len(), 1);
        assert_eq!(written[0]["op"], "scan.plan");
        assert_eq!(written[0]["args"]["mode"], "bring");
        assert!(written[0]["id"].is_i64());
    }

    #[test]
    fn the_relay_overwrites_a_frontend_repository() {
        let dir = TempDir::new().unwrap();
        let (client, _, _, log, _) = client(dir.path(), ECHO, "{}");

        client
            .call(
                "w-1",
                Some(Path::new("/real/folder")),
                "scan.plan",
                json!({ "repository": "/evil" }),
            )
            .unwrap();

        assert_eq!(lines_of(&log)[0]["args"]["repository"], "/real/folder");
    }

    #[test]
    fn stream_items_reach_the_window_that_started_the_scan() {
        let dir = TempDir::new().unwrap();
        let (client, sink, _, _, _) = client(dir.path(), ECHO, r#"{"status":"finished"}"#);
        let reply = client
            .call("w-1", Some(dir.path()), "scan.start", json!({}))
            .unwrap();

        assert_eq!(reply, json!({ "ok": "s1" }));

        wait_until("the outcome", || locked(&sink.0).len() == 2);

        let items = locked(&sink.0).clone();

        assert!(items.iter().all(|(label, _)| label == "w-1"));
        assert_eq!(items[0].1["event"]["kind"], "phase");
        assert_eq!(items[1].1["outcome"]["status"], "finished");
        assert!(!client.runs().running("w-1"));
    }

    #[test]
    fn an_unexpected_exit_restarts_the_service_once_and_fails_the_calls_in_flight() {
        let dir = TempDir::new().unwrap();
        let (client, _, _, _, spawns) = client(dir.path(), ECHO, "{}");
        let ping = |client: &CoreClient, word: &str| {
            client
                .call(
                    "w-1",
                    Some(dir.path()),
                    "scan.plan",
                    json!({ "word": word }),
                )
                .unwrap()
        };

        assert_eq!(ping(&client, "a"), json!({ "ok": "pong" }));

        let died = ping(&client, "die");

        assert_eq!(died["unavailable"]["kind"], "exited");
        assert_eq!(died["unavailable"]["status"], 3);
        assert_eq!(*locked(&spawns), 1);
        assert_eq!(ping(&client, "b"), json!({ "ok": "pong" }));
        assert_eq!(*locked(&spawns), 2);

        let again = ping(&client, "die");

        assert_eq!(again["unavailable"]["kind"], "exited");
        assert_eq!(*locked(&spawns), 2);
    }

    #[test]
    fn a_scan_in_flight_when_the_service_exits_ends_as_crashed() {
        let dir = TempDir::new().unwrap();
        let body = r#"
read -r line
id=${line#*\"id\":}
id=${id%%,*}
echo "{\"id\":$id,\"ok\":\"s1\"}"
exit 9
"#;
        let (client, sink, _, _, _) = client(dir.path(), body, "{}");

        client
            .call("w-1", Some(dir.path()), "scan.start", json!({}))
            .unwrap();

        wait_until("the crashed outcome", || !locked(&sink.0).is_empty());

        let items = locked(&sink.0).clone();

        assert_eq!(items[0].1["outcome"]["status"], "failed");
        assert_eq!(items[0].1["outcome"]["reason"], "crashed");
        assert!(!client.runs().running("w-1"));
    }

    #[test]
    fn a_restart_re_issues_each_windows_watch() {
        let dir = TempDir::new().unwrap();
        let (client, _, _, log, _) = client(dir.path(), ECHO, "{}");

        assert_eq!(
            client
                .call("w-1", Some(dir.path()), "scan.watch", json!({}))
                .unwrap(),
            json!({ "ok": "w1" })
        );

        let died = client
            .call(
                "w-1",
                Some(dir.path()),
                "scan.plan",
                json!({ "word": "die" }),
            )
            .unwrap();

        assert_eq!(died["unavailable"]["kind"], "exited");

        client
            .call("w-1", Some(dir.path()), "scan.plan", json!({}))
            .unwrap();

        let watches = lines_of(&log)
            .into_iter()
            .filter(|line| line["op"] == "scan.watch")
            .count();

        assert_eq!(watches, 2);
    }

    #[test]
    fn closing_a_window_stops_its_scans_and_unwatches() {
        let dir = TempDir::new().unwrap();
        let body = ECHO.replace(
            "echo \"{\\\"stream\\\":\\\"s1\\\",\\\"outcome\\\":$OUTCOME}\"",
            "true",
        );
        let (client, _, _, log, _) = client(dir.path(), &body, "{}");

        client
            .call("w-1", Some(dir.path()), "scan.start", json!({}))
            .unwrap();
        client
            .call("w-1", Some(dir.path()), "scan.watch", json!({}))
            .unwrap();
        client.window_closed("w-1");

        wait_until("the stop and the unwatch", || {
            let lines = lines_of(&log);

            lines
                .iter()
                .any(|line| line["op"] == "scan.stop" && line["args"]["scan"] == "s1")
                && lines
                    .iter()
                    .any(|line| line["op"] == "scan.unwatch" && line["args"]["watch"] == "w1")
        });
        assert!(!client.in_progress("w-1"));
    }

    #[test]
    fn a_refused_lock_clears_the_pending_baseline() {
        let dir = TempDir::new().unwrap();
        let (client, sink, baselines, _, _) =
            client(dir.path(), ECHO, r#"{"status":"refused","reason":"lock"}"#);

        client
            .call("w-1", Some(dir.path()), "scan.start", json!({}))
            .unwrap();

        wait_until("the outcome", || locked(&sink.0).len() == 2);
        wait_until("the baseline to clear", || {
            !locked(&baselines.0).contains("w-1")
        });

        let other = TempDir::new().unwrap();
        let (client, sink, baselines, _, _) =
            self::client(other.path(), ECHO, r#"{"status":"finished"}"#);

        client
            .call("w-2", Some(other.path()), "scan.start", json!({}))
            .unwrap();

        wait_until("the outcome", || locked(&sink.0).len() == 2);

        assert!(locked(&baselines.0).contains("w-2"));
    }

    #[test]
    fn a_second_start_in_one_window_is_refused_and_stop_reaches_the_first() {
        let dir = TempDir::new().unwrap();
        let body = ECHO.replace(
            "echo \"{\\\"stream\\\":\\\"s1\\\",\\\"outcome\\\":$OUTCOME}\"",
            "true",
        );
        let (client, _, _, log, _) = client(dir.path(), &body, "{}");

        client
            .call("w-1", Some(dir.path()), "scan.start", json!({}))
            .unwrap();

        let second = client
            .call("w-1", Some(dir.path()), "scan.start", json!({}))
            .unwrap();

        assert_eq!(second, json!({ "error": "a scan is already running" }));

        client.stop_window("w-1");

        wait_until("the stop", || {
            lines_of(&log)
                .iter()
                .any(|line| line["op"] == "scan.stop" && line["args"]["scan"] == "s1")
        });
    }

    #[test]
    fn no_outcome_after_a_stop_signals_the_service_group() {
        let dir = TempDir::new().unwrap();
        let body = ECHO.replace(
            "echo \"{\\\"stream\\\":\\\"s1\\\",\\\"outcome\\\":$OUTCOME}\"",
            "true",
        );
        let (client, _, _, _, _) = client(dir.path(), &body, "{}");

        client
            .call("w-1", Some(dir.path()), "scan.start", json!({}))
            .unwrap();
        client.stop_window("w-1");

        wait_until("the group to be signalled", || {
            locked(&client.inner.state)
                .live
                .as_ref()
                .is_none_or(|live| live.handle.stopped())
        });
    }

    #[test]
    fn the_service_child_has_piped_stdio_and_its_own_group() {
        let dir = TempDir::new().unwrap();
        let out = dir.path().join("facts");
        let body = format!(
            "pgid=$(ps -o pgid= -p $$ | tr -d ' '); if [ -p /dev/stdin ]; then piped=yes; else piped=no; fi; echo \"$$ $pgid $piped $1 $RECOGNIZER_STARTED_BY\" > {out}; while read -r line; do id=${{line#*\\\"id\\\":}}; id=${{id%%,*}}; echo \"{{\\\"id\\\":$id,\\\"ok\\\":null}}\"; done",
            out = out.display()
        );
        let launcher: Launcher = Box::new(move || {
            let mut command = Command::new("/bin/sh");

            command.arg("-c").arg(&body).arg("sh");

            Ok(command)
        });
        let client = CoreClient::new(
            launcher,
            Arc::new(Collected::default()),
            Arc::new(Held::default()),
        );

        client
            .call("w-1", Some(dir.path()), "scan.plan", json!({}))
            .unwrap();

        let facts = fs::read_to_string(out).unwrap();
        let words: Vec<&str> = facts.split_whitespace().collect();

        assert_eq!(words[0], words[1]);
        assert_eq!(words[2], "yes");
        assert_eq!(words[3], "serve");
        assert_eq!(words[4], "app");
    }

    #[test]
    fn a_profile_noise_never_reaches_the_protocol_lines() {
        use std::os::unix::fs::PermissionsExt;

        let dir = TempDir::new().unwrap();
        let serve = crate::tool_runner::tests::script(
            dir.path(),
            "serve",
            "while read -r line; do id=${line#*\\\"id\\\":}; id=${id%%,*}; echo \"{\\\"id\\\":$id,\\\"ok\\\":\\\"pong\\\"}\"; done",
        );
        let shell = dir.path().join("fake-shell");

        fs::write(
            &shell,
            "#!/bin/sh\nprintf '\\033]1337;RemoteHost=ken@host\\007shell=zsh\\n'\nshift\nexec /bin/sh -c \"$@\"\n",
        )
        .unwrap();
        fs::set_permissions(&shell, fs::Permissions::from_mode(0o755)).unwrap();

        let runner = runner_with(&shell, Duration::from_secs(10), Duration::from_secs(30), 4);
        let client = CoreClient::new(
            runner_launcher(Arc::new(runner), &serve.display().to_string()),
            Arc::new(Collected::default()),
            Arc::new(Held::default()),
        );
        let reply = client
            .call("w-1", Some(dir.path()), "scan.plan", json!({}))
            .unwrap();

        assert_eq!(reply, json!({ "ok": "pong" }));
    }

    #[test]
    fn a_refused_scan_starts_no_process_and_leaves_the_window_free() {
        let dir = TempDir::new().unwrap();
        let folder = fake_commands(dir.path(), "1.2.3");

        fake_command(dir.path(), &folder, "recognizer", "0.1.108");

        let runner = Arc::new(bundled_runner(dir.path(), &folder, "/usr/bin"));
        let client = CoreClient::new(
            runner_launcher(runner, "recognizer"),
            Arc::new(Collected::default()),
            Arc::new(Held::default()),
        );
        let reply = client
            .call("w-1", Some(dir.path()), "scan.start", json!({}))
            .unwrap();
        let gaps = reply["unavailable"]["gaps"].as_array().unwrap();

        assert_eq!(reply["unavailable"]["kind"], "gaps");
        assert_eq!(gaps.len(), 1);
        assert_eq!(gaps[0]["id"], "toolchain:recognizer");
        assert_eq!(gaps[0]["needs"], json!(["scan"]));
        assert!(gaps[0]["line"].as_str().unwrap().contains("1.2.3"));
        assert!(gaps[0]["line"].as_str().unwrap().contains("0.1.108"));
        assert!(!client.runs().running("w-1"));
        assert_eq!(runs_of(dir.path(), "recognizer", "scan-runs"), 0);
    }

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

    #[test]
    fn stopping_with_no_run_does_nothing() {
        let runs = ScanRuns::default();

        runs.stop("w-1");

        assert!(!runs.running("w-1"));
        assert!(runs.begin("w-1").is_ok());
        assert!(runs.begin("w-1").is_err());
        assert!(!runs.finish("w-1"));
    }

    struct Reaper(Vec<std::process::Child>);

    impl Drop for Reaper {
        fn drop(&mut self) {
            for child in &mut self.0 {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }

    fn leader() -> std::process::Child {
        use std::os::unix::process::CommandExt;

        Command::new("/bin/sh")
            .args(["-c", "sleep 60 & wait"])
            .process_group(0)
            .spawn()
            .unwrap()
    }

    fn wait_for_children(pid: u32) -> u32 {
        let deadline = Instant::now() + Duration::from_secs(10);

        loop {
            let found = Command::new("/usr/bin/pgrep")
                .args(["-P", &pid.to_string()])
                .output()
                .ok()
                .and_then(|out| {
                    String::from_utf8_lossy(&out.stdout)
                        .lines()
                        .next()
                        .and_then(|line| line.trim().parse().ok())
                });

            if let Some(child) = found {
                return child;
            }

            assert!(Instant::now() < deadline, "the leader never forked");
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    fn gone(pid: u32) -> bool {
        for _ in 0..600 {
            let probe = Command::new("/bin/ps")
                .args(["-o", "stat=", "-p"])
                .arg(pid.to_string())
                .output()
                .unwrap();
            let text = String::from_utf8_lossy(&probe.stdout).trim().to_string();

            if text.is_empty() || text.starts_with('Z') {
                return true;
            }

            std::thread::sleep(Duration::from_millis(50));
        }

        false
    }

    #[test]
    fn stopping_kills_a_group_that_ignores_term_after_the_backstop() {
        use std::os::unix::process::CommandExt;

        let handle = GroupHandle::with_backstop(Duration::from_millis(300));
        let mut child = Command::new("/bin/sh")
            .args(["-c", "trap '' TERM; while :; do sleep 1; done"])
            .process_group(0)
            .spawn()
            .unwrap();

        handle.started(child.id());
        std::thread::sleep(Duration::from_millis(100));
        handle.stop();
        std::thread::sleep(Duration::from_millis(100));

        assert!(child.try_wait().unwrap().is_none());

        let deadline = Instant::now() + Duration::from_secs(10);

        while child.try_wait().unwrap().is_none() {
            assert!(Instant::now() < deadline, "the group outlived the backstop");
            std::thread::sleep(Duration::from_millis(50));
        }
    }

    #[test]
    fn stopping_a_handle_with_no_pid_yet_takes_the_group_when_the_pid_arrives() {
        let handle = GroupHandle::default();
        let mut reaper = Reaper(Vec::new());
        let child = leader();
        let pid = child.id();
        let sleeper = wait_for_children(pid);

        reaper.0.push(child);
        handle.stop();
        handle.started(pid);

        assert!(gone(sleeper));
        assert!(gone(pid));
    }

    #[test]
    fn the_stderr_reader_keeps_only_the_tail_it_may_hold() {
        let bytes: Vec<u8> = (0..100_000u32).map(|at| (at % 251) as u8).collect();
        let tail = read_tail(bytes.as_slice());

        assert_eq!(tail.len(), STDERR_TAIL_BYTES);
        assert_eq!(tail, bytes[bytes.len() - STDERR_TAIL_BYTES..]);
    }

    fn stderr_of(script: &str) -> String {
        let mut child = Command::new("/bin/sh")
            .args(["-c", script])
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        let tail = read_tail(child.stderr.take().unwrap());

        child.wait().unwrap();

        bound_stderr(&tail)
    }

    #[test]
    fn a_long_stderr_without_a_record_keeps_its_last_8192_characters() {
        assert_eq!(
            stderr_of("printf 'x'; head -c 8192 /dev/zero | tr '\\0' 'y' >&2; exit 2"),
            "y".repeat(8192)
        );
        assert_eq!(
            stderr_of("head -c 8192 /dev/zero | tr '\\0' 'z' >&2; exit 2"),
            "z".repeat(8192)
        );
        assert_eq!(
            stderr_of("head -c 8193 /dev/zero | tr '\\0' 'w' >&2; exit 2"),
            "w".repeat(8192)
        );
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

    const SETUP_SERVICE: &str = r#"
while read -r line; do
  id=${line#*\"id\":}
  id=${id%%,*}
  echo "$line" >> "$LOG"
  case "$line" in
    *'"op":"setup.start"'*)
      echo "{\"id\":$id,\"ok\":\"u1\"}"
      echo '{"stream":"u1","event":"{\"event\":\"start\",\"total\":1}"}'
      echo "{\"stream\":\"u1\",\"outcome\":$OUTCOME}"
      ;;
    *) echo "{\"id\":$id,\"ok\":\"pong\"}" ;;
  esac
done
"#;

    #[test]
    fn a_setup_event_line_is_forwarded_whole() {
        let dir = TempDir::new().unwrap();
        let (client, _, _, log, _) = client(
            dir.path(),
            SETUP_SERVICE,
            r#"{"status":"finished","result":{}}"#,
        );
        let seen = Mutex::new(Vec::new());

        client.run_setup(
            "w-1",
            dir.path(),
            "apply",
            json!({ "choices": {} }),
            |line| locked(&seen).push(line),
        );

        assert_eq!(*locked(&seen), vec![r#"{"event":"start","total":1}"#]);

        let written = lines_of(&log);

        assert_eq!(written[0]["op"], "setup.start");
        assert_eq!(written[0]["args"]["action"], "apply");
        assert_eq!(
            written[0]["args"]["repository"],
            dir.path().display().to_string()
        );
    }

    #[test]
    fn a_setup_outcome_is_the_run_end() {
        let dir = TempDir::new().unwrap();
        let (client, _, _, _, _) = client(
            dir.path(),
            SETUP_SERVICE,
            r#"{"status":"finished","result":{"ok":true}}"#,
        );
        let outcome = client.run_setup("w-1", dir.path(), "try", json!({}), |_| {});

        assert_eq!(
            outcome,
            json!({ "status": "finished", "result": { "ok": true } })
        );
        assert!(!client.setups().running("w-1"));
        assert_eq!(client.setups_running(), 0);
    }

    #[test]
    fn a_setup_in_flight_when_the_service_exits_ends_as_failed() {
        let dir = TempDir::new().unwrap();
        let body = SETUP_SERVICE.replace(
            "echo \"{\\\"stream\\\":\\\"u1\\\",\\\"outcome\\\":$OUTCOME}\"",
            "exit 3",
        );
        let (client, _, _, _, _) = client(dir.path(), &body, "{}");
        let outcome = client.run_setup("w-1", dir.path(), "apply", json!({}), |_| {});

        assert_eq!(outcome["status"], "failed");
        assert!(!client.setups().running("w-1"));
    }

    #[test]
    fn one_setup_per_window_and_stop_marks_it() {
        let runs = SetupLedger::default();

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

    #[test]
    fn a_survey_does_not_count_as_a_running_setup() {
        let runs = SetupLedger::default();
        let key = runs.begin_read("w-1");

        assert_eq!(runs.running_count(), 0);
        assert!(runs.begin("w-1").is_ok());

        runs.finish("w-1");
        runs.finish(&key);
    }

    #[test]
    fn setups_running_counts_every_setup() {
        let runs = SetupLedger::default();

        assert_eq!(runs.running_count(), 0);

        runs.begin("w-1").unwrap();
        runs.begin("w-2").unwrap();

        assert_eq!(runs.running_count(), 2);

        runs.finish("w-1");

        assert_eq!(runs.running_count(), 1);
    }
}
