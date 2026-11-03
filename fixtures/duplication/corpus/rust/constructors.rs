pub struct Orders;
pub struct Parcels;
pub struct Visits;

impl Orders {
    pub fn new(store: Store, clock: Clock, mailer: Mailer, ledger: Ledger) -> Self {
        Self {
            store,
            clock,
            mailer,
            ledger,
        }
    }
}

impl Parcels {
    pub fn new(depot: Depot, scales: Scales, courier: Courier, manifest: Manifest) -> Self {
        Self {
            depot,
            scales,
            courier,
            manifest,
        }
    }
}

impl Visits {
    pub fn new(calendar: Calendar, roster: Roster, notifier: Notifier, journal: Journal) -> Self {
        Self {
            calendar,
            roster,
            notifier,
            journal,
        }
    }
}
