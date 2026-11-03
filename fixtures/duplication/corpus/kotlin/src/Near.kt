package corpus

fun gatherNames(records: List<Record>, prefix: String): List<String> {
    val names = mutableListOf<String>()
    val seen = mutableSetOf<String>()
    for (record in records) {
        if (record.hidden) {
            continue
        }
        val name = prefix + record.label
        if (name in seen) {
            continue
        }
        seen.add(name)
        names.add(name)
    }
    names.sort()
    return names
}

fun gatherTags(entries: List<Entry>, stem: String): List<String> {
    val tags = mutableListOf<String>()
    val known = mutableSetOf<String>()
    for (entry in entries) {
        if (entry.hidden) {
            continue
        }
        val tag = stem + entry.title
        if (tag in known) {
            continue
        }
        known.add(tag)
        tags.add(tag)
    }
    logCount(tags.size)
    tags.sort()
    return tags
}

fun fetchPages(client: Client, query: Query): List<Page> {
    val pages = mutableListOf<Page>()
    var cursor: String? = null
    while (true) {
        val reply = client.get(query, cursor)
        if (reply.failed) {
            throw IllegalStateException(reply.reason)
        }
        pages.addAll(reply.items)
        cursor = reply.nextCursor
        if (cursor == null) {
            break
        }
    }
    return pages
}

fun fetchEvents(session: Session, filter: Filter): List<Event> {
    val events = mutableListOf<Event>()
    var marker: String? = null
    while (true) {
        val answer = session.get(filter, marker)
        if (answer.failed) {
            throw IllegalStateException(answer.reason)
        }
        events.addAll(answer.items)
        marker = answer.nextCursor
        tracePage(marker)
        if (marker == null) {
            break
        }
    }
    return events
}

fun summariseOrders(orders: List<Order>, tax: Int): MutableMap<String, Int> {
    val result = mutableMapOf<String, Int>()
    var count = 0
    for (order in orders) {
        if (order.cancelled) {
            continue
        }
        val key = order.region
        result[key] = (result[key] ?: 0) + order.amount * tax
        count += 1
    }
    result["count"] = count
    return result
}

fun summariseVisits(visits: List<Visit>, levy: Int): MutableMap<String, Int> {
    val result = mutableMapOf<String, Int>()
    var count = 0
    for (visit in visits) {
        if (visit.cancelled) {
            continue
        }
        val key = visit.site
        result[key] = (result[key] ?: 0) + visit.fee * levy
        count += 1
    }
    result["total"] = count
    result["levy"] = levy
    return result
}
