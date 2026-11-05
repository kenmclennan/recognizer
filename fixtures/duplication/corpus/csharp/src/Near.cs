public static class Near
{
    public static List<string> GatherNames(List<Record> records, string prefix)
    {
        var names = new List<string>();
        var seen = new HashSet<string>();
        foreach (var record in records)
        {
            if (record.Hidden)
            {
                continue;
            }
            var name = prefix + record.Label;
            if (seen.Contains(name))
            {
                continue;
            }
            seen.Add(name);
            names.Add(name);
        }
        names.Sort();
        return names;
    }

    public static List<string> GatherTags(List<Entry> entries, string stem)
    {
        var tags = new List<string>();
        var known = new HashSet<string>();
        foreach (var entry in entries)
        {
            if (entry.Hidden)
            {
                continue;
            }
            var tag = stem + entry.Title;
            if (known.Contains(tag))
            {
                continue;
            }
            known.Add(tag);
            tags.Add(tag);
        }
        LogCount(tags.Count);
        tags.Sort();
        return tags;
    }

    public static List<Page> FetchPages(Client client, Query query)
    {
        var pages = new List<Page>();
        string? cursor = null;
        while (true)
        {
            var reply = client.Get(query, cursor);
            if (reply.Failed)
            {
                throw new InvalidOperationException(reply.Reason);
            }
            pages.AddRange(reply.Items);
            cursor = reply.NextCursor;
            if (cursor == null)
            {
                break;
            }
        }
        return pages;
    }

    public static List<Event> FetchEvents(Session session, Filter filter)
    {
        var events = new List<Event>();
        string? marker = null;
        while (true)
        {
            var answer = session.Get(filter, marker);
            if (answer.Failed)
            {
                throw new InvalidOperationException(answer.Reason);
            }
            events.AddRange(answer.Items);
            marker = answer.NextCursor;
            TracePage(marker);
            if (marker == null)
            {
                break;
            }
        }
        return events;
    }

    public static Dictionary<string, int> SummariseOrders(List<Order> orders, int tax)
    {
        var result = new Dictionary<string, int>();
        var count = 0;
        foreach (var order in orders)
        {
            if (order.Cancelled)
            {
                continue;
            }
            var key = order.Region;
            result[key] = result.GetValueOrDefault(key) + order.Amount * tax;
            count += 1;
        }
        result["count"] = count;
        return result;
    }

    public static Dictionary<string, int> SummariseVisits(List<Visit> visits, int levy)
    {
        var result = new Dictionary<string, int>();
        var count = 0;
        foreach (var visit in visits)
        {
            if (visit.Cancelled)
            {
                continue;
            }
            var key = visit.Site;
            result[key] = result.GetValueOrDefault(key) + visit.Fee * levy;
            count += 1;
        }
        result["total"] = count;
        result["levy"] = levy;
        return result;
    }
}
