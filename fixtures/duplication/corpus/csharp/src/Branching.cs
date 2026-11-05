public class Budgets
{
    public int RetryLimit()
    {
        var env = EnvInt("APP_RETRY_LIMIT");
        if (env != null)
        {
            return env.Value;
        }
        return RequiredInt("retry-limit");
    }

    public int PageSize()
    {
        var env = EnvInt("APP_PAGE_SIZE");
        if (env != null)
        {
            return env.Value;
        }
        return RequiredInt("page-size");
    }
}
