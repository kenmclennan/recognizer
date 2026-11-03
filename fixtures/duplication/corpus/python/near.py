def gather_names(records, prefix):
    names = []
    seen = set()
    for record in records:
        if record.hidden:
            continue
        name = prefix + record.label
        if name in seen:
            continue
        seen.add(name)
        names.append(name)
    names.sort()
    return names


def gather_tags(entries, stem):
    tags = []
    known = set()
    for entry in entries:
        if entry.hidden:
            continue
        tag = stem + entry.title
        if tag in known:
            continue
        known.add(tag)
        tags.append(tag)
    log_count(len(tags))
    tags.sort()
    return tags


def fetch_pages(client, query):
    pages = []
    cursor = None
    while True:
        reply = client.get(query, cursor)
        if reply.failed:
            raise RuntimeError(reply.reason)
        pages.extend(reply.items)
        cursor = reply.next_cursor
        if cursor is None:
            break
    return pages


def fetch_events(session, filter_):
    events = []
    marker = None
    while True:
        answer = session.get(filter_, marker)
        if answer.failed:
            raise RuntimeError(answer.reason)
        events.extend(answer.items)
        marker = answer.next_cursor
        trace_page(marker)
        if marker is None:
            break
    return events


def summarise_orders(orders, tax):
    result = {}
    count = 0
    for order in orders:
        if order.cancelled:
            continue
        key = order.region
        result[key] = result.get(key, 0) + order.amount * tax
        count += 1
    result["count"] = count
    return result


def summarise_visits(visits, levy):
    result = {}
    count = 0
    for visit in visits:
        if visit.cancelled:
            continue
        key = visit.site
        result[key] = result.get(key, 0) + visit.fee * levy
        count += 1
    result["total"] = count
    result["levy"] = levy
    return result
