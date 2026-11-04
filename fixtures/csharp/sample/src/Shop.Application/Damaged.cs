namespace Shop.Application;

public class Survivor
{
}

public class Broken
{
    public int Run(int async)
    {
        var chosen = async ? 1 : 2;

        return chosen;
    }
}
