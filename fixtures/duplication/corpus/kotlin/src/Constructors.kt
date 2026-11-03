package corpus

class Orders {
    fun assign(store: Store, clock: Clock, mailer: Mailer, ledger: Ledger) {
        this.store = store
        this.clock = clock
        this.mailer = mailer
        this.ledger = ledger
    }
}

class Parcels {
    fun assign(depot: Depot, scales: Scales, courier: Courier, manifest: Manifest) {
        this.depot = depot
        this.scales = scales
        this.courier = courier
        this.manifest = manifest
    }
}

class Visits {
    fun assign(calendar: Calendar, roster: Roster, notifier: Notifier, journal: Journal) {
        this.calendar = calendar
        this.roster = roster
        this.notifier = notifier
        this.journal = journal
    }
}
