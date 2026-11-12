public class Store
{
    private int[] data;

    public int Total => data.Sum();

    public int this[int index] => data[index];

    public int Get(int key)
    {
        var found = data[key];

        if (found < 0)
        {
            throw new System.Exception("missing");
        }

        return found;
    }

    public int Get(string key)
    {
        return key.Length;
    }

    public int Count
    {
        get { return data.Length; }
        set { data = new int[value]; }
    }

    ~Store()
    {
        data = null;
    }

    public static Store operator +(Store left, Store right)
    {
        return left;
    }
}
