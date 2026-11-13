use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Condvar, Mutex, MutexGuard, OnceLock};
use std::time::{Duration, Instant, SystemTime};

use crate::repository::{missing_hint, OUTPUT_MARK};
use crate::scan_run::kill_group;

const ENVIRONMENT_SCRIPT: &str = r#"printf '\n@@recognizer-output@@\n'; env -0"#;
const RESOLVE_TIMEOUT: Duration = Duration::from_secs(15);
const RETRY_WINDOW: Duration = Duration::from_secs(30);
const MAX_BOUND: usize = 4;
const BUNDLE_FIX: &str = "brew reinstall --cask kenmclennan/tap/recognizer";

pub const COMMANDS: [&str; 1] = ["recognizer"];

#[derive(Clone, Debug, PartialEq)]
pub enum Toolchain {
    Bundled { folder: PathBuf },
    Override { folder: PathBuf },
    Path,
    Unchecked,
}

pub fn is_packaged(executable: &Path) -> bool {
    let Some(macos) = executable.parent() else {
        return false;
    };
    let contents = macos.parent();
    let app = contents.and_then(Path::parent);

    macos.file_name().is_some_and(|name| name == "MacOS")
        && contents.is_some_and(|dir| dir.file_name().is_some_and(|name| name == "Contents"))
        && app.is_some_and(|dir| dir.extension().is_some_and(|ext| ext == "app"))
}

impl Toolchain {
    pub fn choose(
        executable: &Path,
        resource_dir: Option<&Path>,
        override_var: Option<&str>,
        dir_exists: impl Fn(&Path) -> bool,
    ) -> Toolchain {
        if is_packaged(executable) {
            let base = resource_dir.unwrap_or_else(|| Path::new(""));

            return Toolchain::Bundled {
                folder: base.join("toolchain").join("commands"),
            };
        }

        if let Some(dir) = override_var.map(Path::new).filter(|dir| dir.is_absolute()) {
            let folder = dir.join("commands");

            if dir_exists(&folder) {
                return Toolchain::Override { folder };
            }
        }

        Toolchain::Path
    }

    fn folder(&self) -> Option<&Path> {
        match self {
            Toolchain::Bundled { folder } | Toolchain::Override { folder } => Some(folder),
            _ => None,
        }
    }

    fn unchecked(&self) -> bool {
        matches!(self, Toolchain::Unchecked)
    }

    fn fix(&self, expected: &str) -> String {
        match self {
            Toolchain::Bundled { .. } => BUNDLE_FIX.to_string(),
            Toolchain::Override { folder } => format!(
                "rebuild the toolchain at {}",
                folder.parent().unwrap_or(folder).display()
            ),
            _ => format!(
                "put a {expected} toolchain first on PATH, or set RECOGNIZER_TOOLCHAIN to a built toolchain folder"
            ),
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum ToolFault {
    Missing {
        tool: String,
    },
    Mismatch {
        tool: String,
        found: String,
        expected: String,
        path: PathBuf,
        fix: String,
    },
    Incomplete {
        path: PathBuf,
    },
}

pub fn mismatch_message(expected: &str, tool: &str, found: &str, path: &Path, fix: &str) -> String {
    format!(
        "Recognizer {expected} cannot scan with {tool} {found} ({}). Run: {fix}",
        path.display()
    )
}

impl ToolFault {
    pub fn gap_id(&self) -> String {
        match self {
            ToolFault::Missing { tool } | ToolFault::Mismatch { tool, .. } => {
                format!("toolchain:{tool}")
            }
            ToolFault::Incomplete { .. } => "toolchain:incomplete".to_string(),
        }
    }

    pub fn message(&self) -> String {
        match self {
            ToolFault::Missing { .. } => missing_hint(),
            ToolFault::Mismatch {
                tool,
                found,
                expected,
                path,
                fix,
            } => mismatch_message(expected, tool, found, path, fix),
            ToolFault::Incomplete { path } => format!(
                "This installation of Recognizer is incomplete: {} is missing. Run: {BUNDLE_FIX}",
                path.display()
            ),
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
struct Stamp {
    link: Option<(u64, SystemTime)>,
    target: Option<(u64, SystemTime)>,
    canonical: Option<PathBuf>,
}

fn stamp_of(path: &Path) -> Stamp {
    let facts = |metadata: std::fs::Metadata| Some((metadata.len(), metadata.modified().ok()?));
    let canonical = std::fs::canonicalize(path).ok();

    Stamp {
        link: std::fs::symlink_metadata(path).ok().and_then(facts),
        target: canonical
            .as_deref()
            .and_then(|real| std::fs::metadata(real).ok())
            .and_then(facts),
        canonical,
    }
}

fn bounded_output(mut process: Command, timeout: Duration) -> Option<(Option<i32>, Vec<u8>)> {
    process
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());

    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;

        process.process_group(0);
    }

    let mut child = process.spawn().ok()?;
    let mut stdout = child.stdout.take()?;
    let reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();

        let _ = stdout.read_to_end(&mut bytes);

        bytes
    });
    let deadline = Instant::now() + timeout;

    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(10));
            }
            _ => {
                kill_group(child.id());

                let _ = child.kill();
                let _ = child.wait();

                return None;
            }
        }
    };

    Some((status.code(), reader.join().ok()?))
}

fn locked<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|error| error.into_inner())
}

pub fn default_bound() -> usize {
    std::thread::available_parallelism()
        .map(|count| count.get())
        .unwrap_or(1)
        .clamp(1, MAX_BOUND)
}

pub struct Limiter {
    free: Mutex<usize>,
    freed: Condvar,
}

struct Slot<'a>(&'a Limiter);

impl Drop for Slot<'_> {
    fn drop(&mut self) {
        *locked(&self.0.free) += 1;
        self.0.freed.notify_one();
    }
}

impl Limiter {
    pub fn new(bound: usize) -> Self {
        Limiter {
            free: Mutex::new(bound.max(1)),
            freed: Condvar::new(),
        }
    }

    pub fn run<T>(&self, work: impl FnOnce() -> T) -> T {
        let mut free = locked(&self.free);

        while *free == 0 {
            free = self
                .freed
                .wait(free)
                .unwrap_or_else(|error| error.into_inner());
        }

        *free -= 1;
        drop(free);

        let _slot = Slot(self);

        work()
    }
}

enum Flight<V> {
    Pending,
    Done(V),
    Abandoned,
}

struct Shared<V> {
    state: Mutex<Flight<V>>,
    changed: Condvar,
}

pub struct Flights<V: Clone> {
    running: Mutex<HashMap<String, Arc<Shared<V>>>>,
}

struct Leader<'a, V: Clone> {
    flights: &'a Flights<V>,
    key: &'a str,
    shared: Arc<Shared<V>>,
    result: Option<V>,
}

impl<V: Clone> Drop for Leader<'_, V> {
    fn drop(&mut self) {
        locked(&self.flights.running).remove(self.key);

        *locked(&self.shared.state) = match self.result.take() {
            Some(value) => Flight::Done(value),
            None => Flight::Abandoned,
        };
        self.shared.changed.notify_all();
    }
}

impl<V: Clone> Default for Flights<V> {
    fn default() -> Self {
        Flights {
            running: Mutex::new(HashMap::new()),
        }
    }
}

impl<V: Clone> Flights<V> {
    pub fn run(&self, key: &str, work: impl FnOnce() -> V) -> V {
        let (shared, leads) = {
            let mut running = locked(&self.running);

            match running.get(key) {
                Some(existing) => (existing.clone(), false),
                None => {
                    let fresh = Arc::new(Shared {
                        state: Mutex::new(Flight::Pending),
                        changed: Condvar::new(),
                    });

                    running.insert(key.to_string(), fresh.clone());

                    (fresh, true)
                }
            }
        };

        if leads {
            let mut leader = Leader {
                flights: self,
                key,
                shared,
                result: None,
            };
            let value = work();

            leader.result = Some(value.clone());

            return value;
        }

        let mut state = locked(&shared.state);

        while matches!(*state, Flight::Pending) {
            state = shared
                .changed
                .wait(state)
                .unwrap_or_else(|error| error.into_inner());
        }

        match &*state {
            Flight::Done(value) => value.clone(),
            _ => {
                drop(state);

                work()
            }
        }
    }
}

#[derive(Debug)]
pub struct Environment {
    pairs: Vec<(String, String)>,
    path: String,
}

impl Environment {
    fn parse(stdout: &str) -> Option<Environment> {
        let after = &stdout[stdout.find(OUTPUT_MARK)? + OUTPUT_MARK.len()..];
        let body = after.split_once('\n').map_or("", |(_, rest)| rest);
        let pairs: Vec<(String, String)> = body
            .split('\0')
            .filter_map(|entry| entry.split_once('='))
            .filter(|(name, _)| !name.is_empty())
            .map(|(name, value)| (name.to_string(), value.to_string()))
            .collect();
        let path = pairs
            .iter()
            .find(|(name, _)| name == "PATH")
            .map(|(_, value)| value.clone())
            .filter(|value| !value.is_empty())?;

        Some(Environment { pairs, path })
    }

    fn find(&self, command: &str) -> Option<PathBuf> {
        if command.contains('/') {
            return executable(PathBuf::from(command));
        }

        self.path
            .split(':')
            .filter(|dir| !dir.is_empty())
            .find_map(|dir| executable(PathBuf::from(dir).join(command)))
    }
}

fn executable(path: PathBuf) -> Option<PathBuf> {
    let metadata = std::fs::metadata(&path).ok()?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        if metadata.permissions().mode() & 0o111 == 0 {
            return None;
        }
    }

    metadata.is_file().then_some(path)
}

enum EnvironmentState {
    Idle,
    Resolving,
    Ready {
        environment: Arc<Environment>,
        at: Instant,
    },
    Failed(Instant),
}

#[derive(Clone, Debug, PartialEq)]
pub struct Captured {
    pub code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

pub struct ToolRunner {
    shell: String,
    timeout: Duration,
    window: Duration,
    state: Mutex<EnvironmentState>,
    resolved: Condvar,
    limiter: Limiter,
    flights: Flights<Result<Captured, ToolFault>>,
    toolchain: Toolchain,
    expected: String,
    verified: Mutex<HashMap<PathBuf, Stamp>>,
}

pub fn runner() -> &'static ToolRunner {
    static RUNNER: OnceLock<ToolRunner> = OnceLock::new();

    RUNNER.get_or_init(|| {
        let executable = std::env::current_exe().unwrap_or_default();
        let resources = executable
            .parent()
            .and_then(Path::parent)
            .map(|contents| contents.join("Resources"));
        let toolchain = Toolchain::choose(
            &executable,
            resources.as_deref(),
            std::env::var("RECOGNIZER_TOOLCHAIN").ok().as_deref(),
            |dir| dir.is_dir(),
        );

        ToolRunner::new(
            std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string()),
            RESOLVE_TIMEOUT,
            RETRY_WINDOW,
            default_bound(),
            toolchain,
            env!("CARGO_PKG_VERSION"),
        )
    })
}

impl ToolRunner {
    pub fn new(
        shell: String,
        timeout: Duration,
        window: Duration,
        bound: usize,
        toolchain: Toolchain,
        expected: &str,
    ) -> Self {
        ToolRunner {
            toolchain,
            expected: expected.to_string(),
            verified: Mutex::new(HashMap::new()),
            shell,
            timeout,
            window,
            state: Mutex::new(EnvironmentState::Idle),
            resolved: Condvar::new(),
            limiter: Limiter::new(bound),
            flights: Flights::default(),
        }
    }

    fn resolve_environment(&self) -> Option<Environment> {
        let mut process = Command::new(&self.shell);

        process.args(["-ilc", ENVIRONMENT_SCRIPT]);

        let (_, bytes) = bounded_output(process, self.timeout)?;

        Environment::parse(&String::from_utf8_lossy(&bytes))
    }

    fn environment(&self) -> Option<Arc<Environment>> {
        let mut state = locked(&self.state);

        loop {
            match &*state {
                EnvironmentState::Ready { environment, .. } => return Some(environment.clone()),
                EnvironmentState::Failed(at) if at.elapsed() < self.window => return None,
                EnvironmentState::Resolving => {
                    state = self
                        .resolved
                        .wait(state)
                        .unwrap_or_else(|error| error.into_inner());
                }
                _ => {
                    *state = EnvironmentState::Resolving;
                    drop(state);

                    let found = self.resolve_environment().map(Arc::new);

                    let mut state = locked(&self.state);

                    *state = match &found {
                        Some(environment) => EnvironmentState::Ready {
                            environment: environment.clone(),
                            at: Instant::now(),
                        },
                        None => EnvironmentState::Failed(Instant::now()),
                    };
                    self.resolved.notify_all();

                    return found;
                }
            }
        }
    }

    fn forget_stale_environment(&self) {
        let mut state = locked(&self.state);

        if matches!(&*state, EnvironmentState::Ready { at, .. } if at.elapsed() >= self.window) {
            *state = EnvironmentState::Idle;
        }
    }

    fn environment_for(&self) -> Option<Arc<Environment>> {
        if let Some(environment) = self.environment() {
            return Some(environment);
        }

        self.toolchain.folder()?;

        let pairs: Vec<(String, String)> = std::env::vars().collect();
        let path = std::env::var("PATH").unwrap_or_default();

        Some(Arc::new(Environment { pairs, path }))
    }

    fn pairs_for(&self, environment: &Environment) -> Vec<(String, String)> {
        let Some(folder) = self.toolchain.folder() else {
            return environment.pairs.clone();
        };
        let front = folder.display().to_string();
        let mut pairs: Vec<(String, String)> = environment
            .pairs
            .iter()
            .filter(|(name, _)| name != "PATH")
            .cloned()
            .collect();
        let path = if environment.path.is_empty() {
            front
        } else {
            format!("{front}:{}", environment.path)
        };

        pairs.push(("PATH".to_string(), path));

        pairs
    }

    fn resolve(&self, name: &str, environment: &Environment) -> Result<PathBuf, ToolFault> {
        match self.toolchain.folder() {
            Some(folder) => {
                let path = folder.join(name);

                executable(path.clone()).ok_or(ToolFault::Incomplete { path })
            }
            None => environment.find(name).ok_or_else(|| ToolFault::Missing {
                tool: name.to_string(),
            }),
        }
    }

    fn verify(
        &self,
        name: &str,
        program: &Path,
        pairs: &[(String, String)],
    ) -> Result<(), ToolFault> {
        if self.toolchain.unchecked() {
            return Ok(());
        }

        let stamp = stamp_of(program);

        if locked(&self.verified).get(program) == Some(&stamp) {
            return Ok(());
        }

        let mut process = Command::new(program);

        process
            .arg("--version")
            .env_clear()
            .envs(pairs.iter().cloned());

        let found = self
            .limiter
            .run(|| bounded_output(process, self.timeout))
            .filter(|(code, _)| *code == Some(0))
            .map(|(_, bytes)| String::from_utf8_lossy(&bytes).trim().to_string())
            .filter(|text| !text.is_empty())
            .unwrap_or_else(|| "no version".to_string());

        if found == self.expected {
            locked(&self.verified).insert(program.to_path_buf(), stamp);

            return Ok(());
        }

        Err(ToolFault::Mismatch {
            tool: name.to_string(),
            found,
            expected: self.expected.clone(),
            path: program.to_path_buf(),
            fix: self.toolchain.fix(&self.expected),
        })
    }

    pub fn command(&self, command: &str) -> Result<Command, ToolFault> {
        let environment = self.environment_for().ok_or_else(|| ToolFault::Missing {
            tool: command.to_string(),
        })?;
        let program = self.resolve(command, &environment).inspect_err(|fault| {
            if matches!(fault, ToolFault::Missing { .. }) {
                self.forget_stale_environment();
            }
        })?;
        let pairs = self.pairs_for(&environment);

        self.verify(command, &program, &pairs)?;

        let mut process = Command::new(program);

        process.env_clear().envs(pairs);

        Ok(process)
    }

    pub fn external_command(&self, name: &str) -> Result<Command, ToolFault> {
        let environment = self.environment_for().ok_or_else(|| ToolFault::Missing {
            tool: name.to_string(),
        })?;
        let program = environment.find(name).ok_or_else(|| {
            self.forget_stale_environment();

            ToolFault::Missing {
                tool: name.to_string(),
            }
        })?;
        let mut process = Command::new(program);

        process.env_clear().envs(environment.pairs.iter().cloned());

        Ok(process)
    }

    pub fn run_external(
        &self,
        name: &str,
        args: &[&str],
        folder: &Path,
        timeout: Duration,
    ) -> Result<Captured, ToolFault> {
        let mut process = self.external_command(name)?;

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

        self.limiter.run(|| {
            let missing = || ToolFault::Missing {
                tool: name.to_string(),
            };
            let mut child = process.spawn().map_err(|_| missing())?;
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
            let deadline = Instant::now() + timeout;

            let status = loop {
                match child.try_wait() {
                    Ok(Some(status)) => break Some(status),
                    Ok(None) if Instant::now() < deadline => {
                        std::thread::sleep(Duration::from_millis(10));
                    }
                    _ => {
                        kill_group(child.id());

                        let _ = child.kill();
                        let _ = child.wait();

                        break None;
                    }
                }
            };
            let stdout = out.join().unwrap_or_default();
            let stderr = err.join().unwrap_or_default();

            Ok(match status {
                Some(status) => Captured {
                    code: status.code(),
                    stdout: String::from_utf8_lossy(&stdout).into_owned(),
                    stderr: String::from_utf8_lossy(&stderr).into_owned(),
                },
                None => Captured {
                    code: None,
                    stdout: String::new(),
                    stderr: format!("{name} did not answer within {} seconds", timeout.as_secs()),
                },
            })
        })
    }

    pub fn limited<T>(&self, work: impl FnOnce() -> T) -> T {
        self.limiter.run(work)
    }

    pub fn check_all(&self) -> Result<(), ToolFault> {
        if self.toolchain.unchecked() {
            return Ok(());
        }

        let results: Vec<Result<Command, ToolFault>> = std::thread::scope(|scope| {
            let handles: Vec<_> = COMMANDS
                .iter()
                .map(|name| scope.spawn(move || self.command(name)))
                .collect();

            handles
                .into_iter()
                .zip(COMMANDS)
                .map(|(handle, name)| {
                    handle.join().unwrap_or_else(|_| {
                        Err(ToolFault::Missing {
                            tool: name.to_string(),
                        })
                    })
                })
                .collect()
        });

        for result in results {
            result?;
        }

        Ok(())
    }

    fn run_captured(&self, command: &str, args: &[String]) -> Result<Captured, ToolFault> {
        let mut process = self.command(command)?;

        self.limiter.run(|| {
            process
                .args(args)
                .stdin(Stdio::null())
                .output()
                .map(|output| Captured {
                    code: output.status.code(),
                    stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
                    stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
                })
                .map_err(|_| ToolFault::Missing {
                    tool: command.to_string(),
                })
        })
    }

    pub fn capture(
        &self,
        command: &str,
        args: &[String],
        shared: bool,
    ) -> Result<Captured, ToolFault> {
        if !shared {
            return self.run_captured(command, args);
        }

        let key = std::iter::once(command)
            .chain(args.iter().map(String::as_str))
            .collect::<Vec<_>>()
            .join("\0");

        self.flights.run(&key, || self.run_captured(command, args))
    }
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use std::fs;
    use std::path::Path;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tempfile::TempDir;

    pub fn script(dir: &Path, name: &str, body: &str) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;

        let path = dir.join(name);

        fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();

        path
    }

    pub fn shell_running_the_script(dir: &Path, counter: &Path) -> PathBuf {
        script(
            dir,
            "fake-shell",
            &format!(
                "printf '\\033]1337;RemoteHost=ken@host\\007shell=zsh'\necho x >> '{}'\nshift\nexec /bin/sh -c \"$@\"",
                counter.display()
            ),
        )
    }

    pub fn shell_with_path(dir: &Path, path: &str) -> PathBuf {
        script(
            dir,
            "path-shell",
            &format!("printf '\\n@@recognizer-output@@\\nPATH=%s\\0HOME=/h\\0' '{path}'"),
        )
    }

    pub fn runner_with(
        shell: &Path,
        timeout: Duration,
        window: Duration,
        bound: usize,
    ) -> ToolRunner {
        ToolRunner::new(
            shell.display().to_string(),
            timeout,
            window,
            bound,
            Toolchain::Unchecked,
            "0.0.0",
        )
    }

    pub fn working_runner(dir: &Path) -> ToolRunner {
        let counter = dir.join("shell-count");
        let shell = shell_running_the_script(dir, &counter);

        runner_with(&shell, Duration::from_secs(10), Duration::from_secs(30), 4)
    }

    pub fn fake_commands(dir: &Path, version: &str) -> PathBuf {
        let folder = dir.join("commands");

        fs::create_dir_all(&folder).unwrap();

        for name in COMMANDS {
            fake_command(dir, &folder, name, version);
        }

        folder
    }

    pub fn fake_command(dir: &Path, folder: &Path, name: &str, version: &str) -> PathBuf {
        script(
            folder,
            name,
            &format!(
                "if [ \"$1\" = \"--version\" ]; then echo x >> '{dir}/{name}.version-runs'; echo '{version}'; else echo x >> '{dir}/{name}.scan-runs'; echo ran-{name}; fi",
                dir = dir.display()
            ),
        )
    }

    pub fn bundled_runner(dir: &Path, folder: &Path, path: &str) -> ToolRunner {
        let shell = shell_with_path(dir, path);

        ToolRunner::new(
            shell.display().to_string(),
            Duration::from_secs(10),
            Duration::from_secs(30),
            4,
            Toolchain::Bundled {
                folder: folder.to_path_buf(),
            },
            "1.2.3",
        )
    }

    pub fn runs_of(dir: &Path, name: &str, kind: &str) -> usize {
        lines(&dir.join(format!("{name}.{kind}")))
    }

    fn lines(path: &Path) -> usize {
        fs::read_to_string(path).map_or(0, |text| text.lines().count())
    }

    #[test]
    fn the_limiter_never_runs_more_than_its_bound() {
        let limiter = Limiter::new(3);
        let active = AtomicUsize::new(0);
        let peak = AtomicUsize::new(0);
        let ran = AtomicUsize::new(0);

        std::thread::scope(|scope| {
            for _ in 0..40 {
                scope.spawn(|| {
                    limiter.run(|| {
                        let now = active.fetch_add(1, Ordering::SeqCst) + 1;

                        peak.fetch_max(now, Ordering::SeqCst);
                        std::thread::sleep(Duration::from_millis(5));
                        active.fetch_sub(1, Ordering::SeqCst);
                        ran.fetch_add(1, Ordering::SeqCst);
                    });
                });
            }
        });

        assert_eq!(ran.load(Ordering::SeqCst), 40);
        assert!(peak.load(Ordering::SeqCst) <= 3);
    }

    #[test]
    fn the_limiter_releases_its_slot_when_the_work_panics() {
        let limiter = Limiter::new(1);

        let panicked = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            limiter.run(|| panic!("boom"));
        }));

        assert!(panicked.is_err());
        assert_eq!(limiter.run(|| 7), 7);
    }

    #[test]
    fn the_default_bound_is_between_one_and_four() {
        assert!((1..=4).contains(&default_bound()));
    }

    #[test]
    fn the_environment_is_resolved_once_for_many_calls() {
        let dir = TempDir::new().unwrap();
        let counter = dir.path().join("shell-count");
        let shell = shell_running_the_script(dir.path(), &counter);
        let runner = runner_with(&shell, Duration::from_secs(10), Duration::from_secs(30), 4);
        let tool = script(dir.path(), "tool", "echo ok");
        let command = tool.display().to_string();

        std::thread::scope(|scope| {
            for round in 0..20 {
                let (runner, command) = (&runner, &command);

                scope.spawn(move || {
                    let args = vec![format!("verb-{}", round % 5)];

                    assert!(runner.capture(command, &args, false).is_ok());
                });
            }
        });

        assert_eq!(lines(&counter), 1);
    }

    #[test]
    fn a_hung_login_shell_fails_the_resolution_within_the_timeout_and_is_retried_after_the_window()
    {
        let dir = TempDir::new().unwrap();
        let counter = dir.path().join("shell-count");
        let shell = script(
            dir.path(),
            "hung-shell",
            &format!("echo x >> '{}'\nsleep 30", counter.display()),
        );
        let runner = runner_with(
            &shell,
            Duration::from_millis(1000),
            Duration::from_millis(1500),
            4,
        );
        let tool = script(dir.path(), "tool", "echo ok");
        let command = tool.display().to_string();
        let started = Instant::now();

        assert!(runner.capture(&command, &[], false).is_err());
        assert!(started.elapsed() < Duration::from_secs(3));
        assert_eq!(lines(&counter), 1);

        assert!(runner.capture(&command, &[], false).is_err());
        assert_eq!(lines(&counter), 1);

        std::thread::sleep(Duration::from_millis(1600));

        assert!(runner.capture(&command, &[], false).is_err());
        assert_eq!(lines(&counter), 2);
    }

    #[test]
    fn a_command_off_the_resolved_path_is_not_found() {
        let dir = TempDir::new().unwrap();
        let empty = TempDir::new().unwrap();
        let shell = shell_with_path(dir.path(), &empty.path().display().to_string());
        let runner = runner_with(&shell, Duration::from_secs(10), Duration::from_secs(30), 4);

        assert!(runner.capture("recognizer", &[], false).is_err());
        assert!(runner
            .capture("/nonexistent/recognizer", &[], false)
            .is_err());
    }

    #[test]
    fn a_recognizer_installed_later_is_found_after_the_window_passes() {
        let dir = TempDir::new().unwrap();
        let first = TempDir::new().unwrap();
        let second = TempDir::new().unwrap();
        let chosen = dir.path().join("path-file");

        fs::write(&chosen, first.path().display().to_string()).unwrap();

        let shell = script(
            dir.path(),
            "reading-shell",
            &format!(
                "printf '\\n@@recognizer-output@@\\nPATH=%s\\0' \"$(cat '{}')\"",
                chosen.display()
            ),
        );
        let runner = runner_with(&shell, Duration::from_secs(10), Duration::ZERO, 4);

        script(second.path(), "recognizer", "echo 1.2.3");

        assert!(runner.capture("recognizer", &[], false).is_err());

        fs::write(&chosen, second.path().display().to_string()).unwrap();

        let found = runner.capture("recognizer", &[], false).unwrap();

        assert_eq!(found.stdout.trim(), "1.2.3");
    }

    #[test]
    fn identical_checks_in_flight_run_once_and_share_the_result() {
        let dir = TempDir::new().unwrap();
        let runner = working_runner(dir.path());
        let log = dir.path().join("runs");
        let tool = script(
            dir.path(),
            "tool",
            &format!("echo x >> '{}'\nsleep 1\necho 0.9.9", log.display()),
        );
        let command = tool.display().to_string();
        let args = vec!["--version".to_string()];

        let results: Vec<_> = std::thread::scope(|scope| {
            let handles: Vec<_> = (0..10)
                .map(|_| scope.spawn(|| runner.capture(&command, &args, true)))
                .collect();

            handles
                .into_iter()
                .map(|handle| handle.join().unwrap())
                .collect()
        });

        assert_eq!(lines(&log), 1);
        assert!(results.iter().all(|result| result == &results[0]));
        assert_eq!(results[0].as_ref().unwrap().stdout.trim(), "0.9.9");
    }

    #[test]
    fn a_flight_whose_leader_panics_lets_a_waiter_run_its_own_work() {
        let flights: Flights<u32> = Flights::default();

        let panicked = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            flights.run("k", || panic!("boom"));
        }));

        assert!(panicked.is_err());
        assert_eq!(flights.run("k", || 5), 5);
    }

    #[test]
    fn the_environment_parser_keeps_values_with_newlines_and_drops_noise_before_the_mark() {
        let text = format!("\u{1b}]1337;x\u{7}junk\n{OUTPUT_MARK}\nPATH=/a:/b\0MULTI=one\ntwo\0");
        let environment = Environment::parse(&text).unwrap();

        assert_eq!(environment.path, "/a:/b");
        assert!(environment
            .pairs
            .contains(&("MULTI".to_string(), "one\ntwo".to_string())));
        assert!(Environment::parse("PATH=/a\0").is_none());
        assert!(Environment::parse(&format!("{OUTPUT_MARK}\nHOME=/h\0")).is_none());
    }

    #[test]
    fn the_toolchain_chooser_prefers_the_bundle_then_the_override_then_the_path() {
        let packaged = Path::new("/Applications/Recognizer.app/Contents/MacOS/recognizer-app");
        let resources = Path::new("/Applications/Recognizer.app/Contents/Resources");
        let dev = Path::new("/work/target/debug/recognizer-app");
        let exists = |_: &Path| true;

        assert_eq!(
            Toolchain::choose(packaged, Some(resources), Some("/built"), exists),
            Toolchain::Bundled {
                folder: resources.join("toolchain/commands")
            }
        );
        assert_eq!(
            Toolchain::choose(dev, Some(resources), Some("/built"), exists),
            Toolchain::Override {
                folder: PathBuf::from("/built/commands")
            }
        );
        assert_eq!(
            Toolchain::choose(dev, Some(resources), None, exists),
            Toolchain::Path
        );
        assert_eq!(
            Toolchain::choose(dev, None, Some("relative/dir"), exists),
            Toolchain::Path
        );
        assert_eq!(
            Toolchain::choose(dev, None, Some("/built"), |_| false),
            Toolchain::Path
        );
    }

    #[test]
    fn a_packaged_run_uses_the_bundle_even_when_the_path_holds_another_recognizer() {
        let dir = TempDir::new().unwrap();
        let elsewhere = TempDir::new().unwrap();
        let folder = fake_commands(dir.path(), "1.2.3");

        script(
            elsewhere.path(),
            "recognizer",
            "if [ \"$1\" = \"--version\" ]; then echo 0.1.108; else echo from-path; fi",
        );

        let runner = bundled_runner(dir.path(), &folder, &elsewhere.path().display().to_string());
        let captured = runner.capture("recognizer", &[], false).unwrap();

        assert_eq!(captured.stdout.trim(), "ran-recognizer");
        assert_eq!(runs_of(dir.path(), "recognizer", "scan-runs"), 1);
    }

    #[test]
    fn a_packaged_run_hands_the_tool_a_path_that_starts_with_the_bundle_folder() {
        let dir = TempDir::new().unwrap();
        let folder = fake_commands(dir.path(), "1.2.3");
        let runner = bundled_runner(dir.path(), &folder, "/usr/bin:/bin");
        let process = runner.command("recognizer").unwrap();
        let path = process
            .get_envs()
            .find(|(name, _)| *name == "PATH")
            .and_then(|(_, value)| value)
            .unwrap()
            .to_string_lossy()
            .into_owned();

        assert_eq!(path, format!("{}:/usr/bin:/bin", folder.display()));
    }

    #[test]
    fn a_packaged_run_with_a_missing_entry_is_incomplete_and_never_consults_the_path() {
        let dir = TempDir::new().unwrap();
        let elsewhere = TempDir::new().unwrap();
        let folder = fake_commands(dir.path(), "1.2.3");

        fs::remove_file(folder.join("recognizer")).unwrap();
        script(elsewhere.path(), "recognizer", "echo 1.2.3");

        let runner = bundled_runner(dir.path(), &folder, &elsewhere.path().display().to_string());
        let fault = runner.capture("recognizer", &[], false).unwrap_err();

        assert_eq!(
            fault,
            ToolFault::Incomplete {
                path: folder.join("recognizer")
            }
        );
        assert!(fault.message().contains("incomplete"));
        assert!(fault
            .message()
            .contains("brew reinstall --cask kenmclennan/tap/recognizer"));
    }

    #[test]
    fn a_tool_that_prints_another_version_is_a_mismatch_naming_both_versions_the_tool_and_the_fix()
    {
        let dir = TempDir::new().unwrap();
        let folder = fake_commands(dir.path(), "1.2.3");

        fake_command(dir.path(), &folder, "recognizer", "0.1.108");

        let runner = bundled_runner(dir.path(), &folder, "/usr/bin");
        let fault = runner.capture("recognizer", &[], false).unwrap_err();
        let message = fault.message();

        assert!(matches!(fault, ToolFault::Mismatch { .. }));
        assert_eq!(
            message,
            format!(
                "Recognizer 1.2.3 cannot scan with recognizer 0.1.108 ({}). Run: brew reinstall --cask kenmclennan/tap/recognizer",
                folder.join("recognizer").display()
            )
        );
        assert_eq!(runs_of(dir.path(), "recognizer", "scan-runs"), 0);
    }

    #[test]
    fn a_tool_that_prints_nothing_or_exits_non_zero_is_a_mismatch_showing_no_version() {
        let dir = TempDir::new().unwrap();
        let folder = fake_commands(dir.path(), "1.2.3");

        let runner = bundled_runner(dir.path(), &folder, "/usr/bin");

        for body in ["exit 0", "echo 1.2.3\nexit 3"] {
            script(&folder, "recognizer", body);

            let message = runner
                .capture("recognizer", &[], false)
                .unwrap_err()
                .message();

            assert!(message.contains("recognizer no version"), "{message}");
        }
    }

    #[test]
    fn a_development_path_tool_of_another_version_is_refused_with_the_path_fix() {
        let dir = TempDir::new().unwrap();
        let folder = fake_commands(dir.path(), "0.1.108");
        let shell = shell_with_path(dir.path(), &folder.display().to_string());
        let runner = ToolRunner::new(
            shell.display().to_string(),
            Duration::from_secs(10),
            Duration::from_secs(30),
            4,
            Toolchain::Path,
            "1.2.3",
        );
        let message = runner
            .capture("recognizer", &[], false)
            .unwrap_err()
            .message();

        assert!(message.contains(
            "put a 1.2.3 toolchain first on PATH, or set RECOGNIZER_TOOLCHAIN to a built toolchain folder"
        ));
    }

    #[test]
    fn an_override_toolchain_of_another_version_says_to_rebuild_it() {
        let dir = TempDir::new().unwrap();
        let folder = fake_commands(dir.path(), "0.1.108");
        let shell = shell_with_path(dir.path(), "/usr/bin");
        let runner = ToolRunner::new(
            shell.display().to_string(),
            Duration::from_secs(10),
            Duration::from_secs(30),
            4,
            Toolchain::Override {
                folder: folder.clone(),
            },
            "1.2.3",
        );
        let message = runner
            .capture("recognizer", &[], false)
            .unwrap_err()
            .message();

        assert!(message.contains(&format!(
            "rebuild the toolchain at {}",
            dir.path().display()
        )));
    }

    #[test]
    fn a_passing_check_is_remembered_until_the_file_changes_and_a_failure_is_not() {
        let dir = TempDir::new().unwrap();
        let folder = fake_commands(dir.path(), "1.2.3");
        let runner = bundled_runner(dir.path(), &folder, "/usr/bin");

        assert!(runner.capture("recognizer", &[], false).is_ok());
        assert!(runner.capture("recognizer", &[], false).is_ok());
        assert_eq!(runs_of(dir.path(), "recognizer", "version-runs"), 1);

        std::thread::sleep(Duration::from_millis(20));
        fake_command(dir.path(), &folder, "recognizer", "1.2.3 ");

        assert!(runner.capture("recognizer", &[], false).is_ok());
        assert_eq!(runs_of(dir.path(), "recognizer", "version-runs"), 2);

        fake_command(dir.path(), &folder, "recognizer", "9.9.9");

        assert!(runner.capture("recognizer", &[], false).is_err());
        assert!(runner.capture("recognizer", &[], false).is_err());
        assert_eq!(runs_of(dir.path(), "recognizer", "version-runs"), 4);
    }

    #[test]
    fn checking_the_command_refuses_when_it_disagrees() {
        let dir = TempDir::new().unwrap();
        let folder = fake_commands(dir.path(), "1.2.3");

        fake_command(dir.path(), &folder, "recognizer", "0.1.108");

        let runner = bundled_runner(dir.path(), &folder, "/usr/bin");
        let fault = runner.check_all().unwrap_err();

        assert!(matches!(
            &fault,
            ToolFault::Mismatch { tool, found, expected, .. }
                if tool == "recognizer" && found == "0.1.108" && expected == "1.2.3"
        ));
        assert!(fault
            .message()
            .contains("brew reinstall --cask kenmclennan/tap/recognizer"));

        for name in COMMANDS {
            assert_eq!(runs_of(dir.path(), name, "scan-runs"), 0);
        }
    }

    #[test]
    fn checking_the_command_passes_when_it_agrees() {
        let dir = TempDir::new().unwrap();
        let folder = fake_commands(dir.path(), "1.2.3");
        let runner = bundled_runner(dir.path(), &folder, "/usr/bin");

        assert!(runner.check_all().is_ok());
    }

    #[test]
    fn checking_a_bundled_folder_without_the_command_is_incomplete() {
        let dir = TempDir::new().unwrap();
        let folder = fake_commands(dir.path(), "1.2.3");

        fs::remove_file(folder.join("recognizer")).unwrap();

        let runner = bundled_runner(dir.path(), &folder, "/usr/bin");

        assert_eq!(
            runner.check_all().unwrap_err(),
            ToolFault::Incomplete {
                path: folder.join("recognizer")
            }
        );
    }

    #[test]
    fn a_command_outside_the_list_is_still_version_checked() {
        let dir = TempDir::new().unwrap();
        let folder = fake_commands(dir.path(), "1.2.3");

        assert!(!COMMANDS.contains(&"recognizer-scan-python"));

        fake_command(dir.path(), &folder, "recognizer-scan-python", "9.9.9");

        let runner = bundled_runner(dir.path(), &folder, "/usr/bin");
        let fault = runner
            .capture("recognizer-scan-python", &[], false)
            .unwrap_err();

        assert!(matches!(
            fault,
            ToolFault::Mismatch { ref tool, ref found, .. }
                if tool == "recognizer-scan-python" && found == "9.9.9"
        ));
    }

    #[test]
    fn the_runner_checks_recognizer_only() {
        assert_eq!(COMMANDS, ["recognizer"]);
    }
}
