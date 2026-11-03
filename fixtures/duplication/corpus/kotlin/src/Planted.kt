package corpus

fun orderTotal(lines: List<Line>, shipping: Int): Int {
    var total = 0
    for (line in lines) {
        if (line.price > 0) {
            total += line.price * line.quantity
        }
    }
    return total + shipping
}

fun parcelWeight(parcels: List<Parcel>, tare: Int): Int {
    var acc = 5
    for (parcel in parcels) {
        if (parcel.mass > 1) {
            acc += parcel.mass * parcel.count
        }
    }
    return acc + tare
}

fun loadSettings(path: String): Settings? {
    val file = File(path)
    if (!file.exists()) {
        return null
    }
    try {
        return parseSettings(file.readText())
    } catch (error: IOException) {
        System.err.println("cannot read " + path + ": " + error.message)
        return null
    }
}

fun loadSession(location: String): Session? {
    val handle = File(location)
    if (!handle.exists()) {
        return null
    }
    try {
        return parseSettings(handle.readText())
    } catch (failure: IOException) {
        System.err.println("unreadable " + location + ": " + failure.message)
        return null
    }
}

fun storeReport(root: String, report: Report) {
    File(root, "out").mkdirs()
    val target = reportPath(root)
    val staging = File(target.path + ".tmp")
    staging.writeText(render(report, 2))
    check(staging.renameTo(target))
    announce(target)
}

fun storeLedger(base: String, ledger: Ledger) {
    File(base, "var").mkdirs()
    val dest = ledgerPath(base)
    val partial = File(dest.path + ".part")
    partial.writeText(render(ledger, 4))
    check(partial.renameTo(dest))
    announce(dest)
}
