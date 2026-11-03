export function gatherNames(records: Record[], prefix: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const record of records) {
    if (record.hidden) {
      continue;
    }
    const name = prefix + record.label;
    if (seen.has(name)) {
      continue;
    }
    seen.add(name);
    names.push(name);
  }
  names.sort();
  return names;
}

export function gatherTags(entries: Entry[], stem: string): string[] {
  const tags: string[] = [];
  const known = new Set<string>();
  for (const entry of entries) {
    if (entry.hidden) {
      continue;
    }
    const tag = stem + entry.title;
    if (known.has(tag)) {
      continue;
    }
    known.add(tag);
    tags.push(tag);
  }
  logCount(tags.length);
  tags.sort();
  return tags;
}

export async function fetchPages(client: Client, query: Query): Promise<Page[]> {
  const pages: Page[] = [];
  let cursor: string | null = null;
  for (;;) {
    const reply = await client.get(query, cursor);
    if (reply.failed) {
      throw new Error(reply.reason);
    }
    pages.push(...reply.items);
    cursor = reply.nextCursor;
    if (cursor === null) {
      break;
    }
  }
  return pages;
}

export async function fetchEvents(session: Session, filter: Filter): Promise<Event[]> {
  const events: Event[] = [];
  let marker: string | null = null;
  for (;;) {
    const answer = await session.get(filter, marker);
    if (answer.failed) {
      throw new Error(answer.reason);
    }
    events.push(...answer.items);
    marker = answer.nextCursor;
    tracePage(marker);
    if (marker === null) {
      break;
    }
  }
  return events;
}

export function summariseOrders(orders: Order[], tax: number): Totals {
  const result: Totals = {};
  let count = 0;
  for (const order of orders) {
    if (order.cancelled) {
      continue;
    }
    const key = order.region;
    result[key] = (result[key] ?? 0) + order.amount * tax;
    count += 1;
  }
  result.count = count;
  return result;
}

export function summariseVisits(visits: Visit[], levy: number): Totals {
  const result: Totals = {};
  let count = 0;
  for (const visit of visits) {
    if (visit.cancelled) {
      continue;
    }
    const key = visit.site;
    result[key] = (result[key] ?? 0) + visit.fee * levy;
    count += 1;
  }
  result.total = count;
  result.levy = levy;
  return result;
}
