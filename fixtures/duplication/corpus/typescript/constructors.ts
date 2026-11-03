export class Orders {
  constructor(store: Store, clock: Clock, mailer: Mailer, ledger: Ledger) {
    this.store = store;
    this.clock = clock;
    this.mailer = mailer;
    this.ledger = ledger;
  }
}

export class Parcels {
  constructor(depot: Depot, scales: Scales, courier: Courier, manifest: Manifest) {
    this.depot = depot;
    this.scales = scales;
    this.courier = courier;
    this.manifest = manifest;
  }
}

export class Visits {
  constructor(calendar: Calendar, roster: Roster, notifier: Notifier, journal: Journal) {
    this.calendar = calendar;
    this.roster = roster;
    this.notifier = notifier;
    this.journal = journal;
  }
}
