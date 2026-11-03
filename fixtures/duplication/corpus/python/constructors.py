class Orders:
    def __init__(self, store, clock, mailer, ledger):
        self.store = store
        self.clock = clock
        self.mailer = mailer
        self.ledger = ledger


class Parcels:
    def __init__(self, depot, scales, courier, manifest):
        self.depot = depot
        self.scales = scales
        self.courier = courier
        self.manifest = manifest


class Visits:
    def __init__(self, calendar, roster, notifier, journal):
        self.calendar = calendar
        self.roster = roster
        self.notifier = notifier
        self.journal = journal
