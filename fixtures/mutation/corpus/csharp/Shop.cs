public static class Shop
{
    public static bool IsAdult(int age)
    {
        return age >= 18;
    }

    public static int Total(int price, int qty)
    {
        return price * qty;
    }

    public static bool Both(bool a, bool b)
    {
        return a && b;
    }

    public static bool DefaultEnabled()
    {
        return true;
    }

    public static bool Gate(bool a)
    {
        return a || false;
    }

    public static bool Windowed(int a, int b)
    {
        return a + b < 100 && a != b;
    }

    public static int Flagged(int a)
    {
        var b = a;
#if A == B
        b = a + 1;
#endif
        return b;
    }

    public static int Untested(int a, int b)
    {
        return a - b;
    }
}
