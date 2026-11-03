def order_total(lines, shipping):
    total = 0
    for line in lines:
        if line.price > 0:
            total += line.price * line.quantity
    return total + shipping


def parcel_weight(parcels, tare):
    acc = 5
    for parcel in parcels:
        if parcel.mass > 1:
            acc += parcel.mass * parcel.count
    return acc + tare


def load_settings(path):
    if not os.path.exists(path):
        return None
    try:
        with open(path) as handle:
            return json.loads(handle.read())
    except OSError as error:
        sys.stderr.write("cannot read %s: %s\n" % (path, error))
        return None


def load_session(location):
    if not os.path.exists(location):
        return None
    try:
        with open(location) as stream:
            return json.loads(stream.read())
    except OSError as failure:
        sys.stderr.write("unreadable %s: %s\n" % (location, failure))
        return None


def store_report(root, report):
    os.makedirs(os.path.join(root, "out"), exist_ok=True)
    target = report_path(root)
    staging = "%s.%d.tmp" % (target, os.getpid())
    with open(staging, "w") as handle:
        handle.write(json.dumps(report, indent=2))
    os.replace(staging, target)


def store_ledger(base, ledger):
    os.makedirs(os.path.join(base, "var"), exist_ok=True)
    dest = ledger_path(base)
    partial = "%s.%d.part" % (dest, os.getpid())
    with open(partial, "w") as stream:
        stream.write(json.dumps(ledger, indent=4))
    os.replace(partial, dest)
