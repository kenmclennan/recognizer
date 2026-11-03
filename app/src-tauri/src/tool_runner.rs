use std::collections::HashMap;
use std::io::Read;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{Arc, Condvar, Mutex, MutexGuard, OnceLock};
use std::time::{Duration, Instant};

use crate::repository::OUTPUT_MARK;
use crate::scan_run::kill_group;

const ENVIRONMENT_SCRIPT: &str = r#"printf '\n@@recognizer-output@@\n'; env -0"#;
const RESOLVE_TIMEOUT: Duration = Duration::from_secs(15);
const RETRY_WINDOW: Duration = Duration::from_secs(30);
const MAX_BOUND: usize = 4;

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
    flights: Flights<Option<Captured>>,
}

pub fn runner() -> &'static ToolRunner {
    static RUNNER: OnceLock<ToolRunner> = OnceLock::new();

    RUNNER.get_or_init(|| {
        ToolRunner::new(
            std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string()),
            RESOLVE_TIMEOUT,
            RETRY_WINDOW,
            default_bound(),
        )
    })
}

impl ToolRunner {
    pub fn new(shell: String, timeout: Duration, window: Duration, bound: usize) -> Self {
        ToolRunner {
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

        process
            .args(["-ilc", ENVIRONMENT_SCRIPT])
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
        let deadline = Instant::now() + self.timeout;

        loop {
            match child.try_wait() {
                Ok(Some(_)) => break,
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
        }

        let bytes = reader.join().ok()?;

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

    pub fn command(&self, command: &str) -> Option<Command> {
        let environment = self.environment()?;

        match environment.find(command) {
            Some(program) => {
                let mut process = Command::new(program);

                process.env_clear().envs(environment.pairs.iter().cloned());

                Some(process)
            }
            None => {
                self.forget_stale_environment();

                None
            }
        }
    }

    fn run_captured(&self, command: &str, args: &[String]) -> Option<Captured> {
        let mut process = self.command(command)?;

        self.limiter.run(|| {
            process
                .args(args)
                .stdin(Stdio::null())
                .output()
                .ok()
                .map(|output| Captured {
                    code: output.status.code(),
                    stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
                    stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
                })
        })
    }

    pub fn capture(&self, command: &str, args: &[String], shared: bool) -> Option<Captured> {
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
        ToolRunner::new(shell.display().to_string(), timeout, window, bound)
    }

    pub fn working_runner(dir: &Path) -> ToolRunner {
        let counter = dir.join("shell-count");
        let shell = shell_running_the_script(dir, &counter);

        runner_with(&shell, Duration::from_secs(10), Duration::from_secs(30), 4)
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

                    assert!(runner.capture(command, &args, false).is_some());
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
            Duration::from_millis(200),
            Duration::from_millis(1500),
            4,
        );
        let tool = script(dir.path(), "tool", "echo ok");
        let command = tool.display().to_string();
        let started = Instant::now();

        assert!(runner.capture(&command, &[], false).is_none());
        assert!(started.elapsed() < Duration::from_secs(2));
        assert_eq!(lines(&counter), 1);

        assert!(runner.capture(&command, &[], false).is_none());
        assert_eq!(lines(&counter), 1);

        std::thread::sleep(Duration::from_millis(1600));

        assert!(runner.capture(&command, &[], false).is_none());
        assert_eq!(lines(&counter), 2);
    }

    #[test]
    fn a_command_off_the_resolved_path_is_not_found() {
        let dir = TempDir::new().unwrap();
        let empty = TempDir::new().unwrap();
        let shell = shell_with_path(dir.path(), &empty.path().display().to_string());
        let runner = runner_with(&shell, Duration::from_secs(10), Duration::from_secs(30), 4);

        assert!(runner.capture("recognizer", &[], false).is_none());
        assert!(runner
            .capture("/nonexistent/recognizer", &[], false)
            .is_none());
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

        assert!(runner.capture("recognizer", &[], false).is_none());

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
}
