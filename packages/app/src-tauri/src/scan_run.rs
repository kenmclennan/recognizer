use std::process::{Command, Stdio};
use std::thread;
use std::time::Duration;

pub const STOP_BACKSTOP: Duration = Duration::from_secs(15);

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

fn kill_group_hard(pid: u32) {
    let _ = Command::new("/bin/kill")
        .args(["-KILL", "--"])
        .arg(format!("-{pid}"))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

pub fn schedule_backstop(pid: u32, delay: Duration) {
    thread::spawn(move || {
        thread::sleep(delay);

        if pid_alive(pid) {
            kill_group_hard(pid);
        }
    });
}

pub fn group_alive(pid: u32) -> bool {
    Command::new("/bin/kill")
        .args(["-0", "--"])
        .arg(format!("-{pid}"))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|status| status.success())
}

pub fn terminate_group_detached(pid: u32, backstop: Duration) {
    use std::os::unix::process::CommandExt;

    let seconds = backstop.as_secs_f64();
    let script = format!(
        "/bin/kill -TERM -- -{pid} 2>/dev/null; /bin/sleep {seconds:.1}; /bin/kill -0 -- -{pid} 2>/dev/null && /bin/kill -KILL -- -{pid} 2>/dev/null"
    );

    let _ = Command::new("/bin/sh")
        .args(["-c", &script])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .process_group(0)
        .spawn();
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
