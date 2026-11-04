public class Orders
{
    public Orders(Store store, Clock clock, Mailer mailer, Ledger ledger)
    {
        this.store = store;
        this.clock = clock;
        this.mailer = mailer;
        this.ledger = ledger;
    }
}

public class Parcels
{
    public Parcels(Depot depot, Scales scales, Courier courier, Manifest manifest)
    {
        this.depot = depot;
        this.scales = scales;
        this.courier = courier;
        this.manifest = manifest;
    }
}

public class Visits
{
    public Visits(Calendar calendar, Roster roster, Notifier notifier, Journal journal)
    {
        this.calendar = calendar;
        this.roster = roster;
        this.notifier = notifier;
        this.journal = journal;
    }
}
