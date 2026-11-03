pub fn gather_names(records: &[Record], prefix: &str) -> Vec<String> {
    let mut names = Vec::new();
    let mut seen = HashSet::new();
    for record in records {
        if record.hidden {
            continue;
        }
        let name = format!("{}{}", prefix, record.label);
        if seen.contains(&name) {
            continue;
        }
        seen.insert(name.clone());
        names.push(name);
    }
    names.sort();
    names
}

pub fn gather_tags(entries: &[Entry], stem: &str) -> Vec<String> {
    let mut tags = Vec::new();
    let mut known = HashSet::new();
    for entry in entries {
        if entry.hidden {
            continue;
        }
        let tag = format!("{}{}", stem, entry.title);
        if known.contains(&tag) {
            continue;
        }
        known.insert(tag.clone());
        tags.push(tag);
    }
    log_count(tags.len());
    tags.sort();
    tags
}

pub fn fetch_pages(client: &Client, query: &Query) -> Result<Vec<Page>, Error> {
    let mut pages = Vec::new();
    let mut cursor = None;
    loop {
        let reply = client.get(query, cursor)?;
        if reply.failed {
            return Err(Error::new(reply.reason));
        }
        pages.extend(reply.items);
        cursor = reply.next_cursor;
        if cursor.is_none() {
            break;
        }
    }
    Ok(pages)
}

pub fn fetch_events(session: &Session, filter: &Filter) -> Result<Vec<Event>, Error> {
    let mut events = Vec::new();
    let mut marker = None;
    loop {
        let answer = session.get(filter, marker)?;
        if answer.failed {
            return Err(Error::new(answer.reason));
        }
        events.extend(answer.items);
        marker = answer.next_cursor;
        trace_page(&marker);
        if marker.is_none() {
            break;
        }
    }
    Ok(events)
}

pub fn summarise_orders(orders: &[Order], tax: i64) -> HashMap<String, i64> {
    let mut result = HashMap::new();
    let mut count = 0;
    for order in orders {
        if order.cancelled {
            continue;
        }
        let key = order.region.clone();
        *result.entry(key).or_insert(0) += order.amount * tax;
        count += 1;
    }
    result.insert("count".to_string(), count);
    result
}

pub fn summarise_visits(visits: &[Visit], levy: i64) -> HashMap<String, i64> {
    let mut result = HashMap::new();
    let mut count = 0;
    for visit in visits {
        if visit.cancelled {
            continue;
        }
        let key = visit.site.clone();
        *result.entry(key).or_insert(0) += visit.fee * levy;
        count += 1;
    }
    result.insert("total".to_string(), count);
    result.insert("levy".to_string(), levy);
    result
}
