public class Limits
{
    public int RetryLimit()
    {
        return settings.Section("limits").Entry(
            "retry-limit",
            0
        );
    }

    public int PageSize()
    {
        return settings.Section("limits").Entry(
            "page-size",
            0
        );
    }

    public int QueueDepth => settings.Section("limits").Entry(
        "queue-depth",
        0
    );

    public int IdleTimeout => settings.Section("limits").Entry(
        "idle-timeout",
        0
    );
}
