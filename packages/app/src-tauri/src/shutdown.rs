use signal_hook::consts::{SIGINT, SIGTERM};
use signal_hook::iterator::Signals;

use crate::core_client::{ScanRuns, SetupLedger};

pub fn stop_for_signal(
    scans: &ScanRuns,
    setups: &SetupLedger,
    stop_service: impl FnOnce(),
    confirm_quit: impl FnOnce(),
    exit: impl FnOnce(),
) {
    scans.stop_all();
    setups.stop_all();
    stop_service();
    confirm_quit();
    exit();
}

pub fn listen(on_signal: impl Fn() + Send + 'static) -> Result<(), String> {
    let mut signals = Signals::new([SIGTERM, SIGINT]).map_err(|error| error.to_string())?;

    std::thread::Builder::new()
        .name("signal-listener".to_string())
        .spawn(move || {
            for _ in signals.forever() {
                on_signal();
            }
        })
        .map_err(|error| error.to_string())?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;
    use std::sync::mpsc;
    use std::time::Duration;

    use super::*;

    fn two_scans_and_a_setup() -> (ScanRuns, SetupLedger) {
        let scans = ScanRuns::default();
        let setups = SetupLedger::default();

        scans.begin("w-1");
        scans.begin("w-2");
        setups.begin("w-1").unwrap();

        assert_eq!(scans.in_progress_labels().len(), 2);

        (scans, setups)
    }

    #[test]
    fn a_signal_stops_every_run_then_exits() {
        let (scans, setups) = two_scans_and_a_setup();
        let confirmed = RefCell::new(0);
        let exits = RefCell::new(Vec::new());

        stop_for_signal(
            &scans,
            &setups,
            || {},
            || *confirmed.borrow_mut() += 1,
            || {
                exits.borrow_mut().push((
                    *confirmed.borrow(),
                    scans.in_progress_labels().is_empty(),
                    setups.stopped("w-1"),
                ))
            },
        );

        assert_eq!(*exits.borrow(), vec![(1, true, true)]);
    }

    #[test]
    fn a_confirmed_quit_with_one_setup_run_stops_it_before_exit() {
        let scans = ScanRuns::default();
        let setups = SetupLedger::default();
        let stopped_at_exit = RefCell::new(None);

        setups.begin("w-1").unwrap();

        stop_for_signal(
            &scans,
            &setups,
            || {},
            || {},
            || {
                *stopped_at_exit.borrow_mut() = Some(setups.stopped("w-1"));
            },
        );

        assert_eq!(*stopped_at_exit.borrow(), Some(true));
    }

    #[test]
    fn the_exit_closure_runs_after_the_stops() {
        let (scans, setups) = two_scans_and_a_setup();
        let events = RefCell::new(Vec::new());

        stop_for_signal(
            &scans,
            &setups,
            || {},
            || events.borrow_mut().push("confirm"),
            || {
                let stopped = scans.in_progress_labels().is_empty() && setups.stopped("w-1");

                events.borrow_mut().push(if stopped {
                    "exit-after-stops"
                } else {
                    "exit-early"
                });
            },
        );

        assert_eq!(*events.borrow(), vec!["confirm", "exit-after-stops"]);
    }

    #[test]
    fn a_sigterm_reaches_the_callback() {
        let (sender, receiver) = mpsc::channel();
        let sender = std::sync::Mutex::new(sender);

        listen(move || {
            let _ = sender.lock().unwrap().send(());
        })
        .unwrap();

        signal_hook::low_level::raise(SIGTERM).unwrap();

        assert!(receiver.recv_timeout(Duration::from_secs(10)).is_ok());
    }
}
