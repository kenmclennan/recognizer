using System;

public static class Risk
{
    private static int a = 1;

    public static int straight(int x) {
        var y = x + 1;
        return y;
    }

    public static int Flag => a > 0 ? 1 : 2;

    public static int Guarded {
        get {
            if (a > 0 && a < 9) { return 1; }
            return 0;
        }
    }

    public static int stacked(int x) {
        switch (x) {
            case 1:
            case 2: return 1;
            default: return 0;
        }
    }

    public static int arms(int x) {
        return x switch {
            1 => 10,
            2 => 20,
            3 => 30,
            _ => 0,
        };
    }

    public static int chain(string? s) {
        var n = s?.Trim()?.Length ?? 0;
        if (n > 3) { return 1; }
        while (n > 0) { n--; }
        return n;
    }

    public static int filtered(Func<int> f) {
        try {
            return f();
        } catch (InvalidOperationException e) when (e.Message.Length > 0 && e.HResult != 0) {
            return 1;
        } catch (Exception) {
            for (var i = 0; i < 3; i++) { }
            foreach (var j in new[] { 1 }) { }
            do { } while (false);
            return 2;
        }
    }

    public static int withLocal(int x) {
        int Local(int y) { return y > 0 ? 1 : 2; }
        if (x > 0) { x += 1; }
        if (x > 1) { x += 1; }
        if (x > 2) { x += 1; }
        if (x > 3) { x += 1; }
        if (x > 4) { x += 1; }
        if (x > 5) { x += 1; }
        if (x > 6) { x += 1; }
        return Local(x);
    }

    public static int lambda(int x) {
        Func<int, int> l = q => q > 0 && q < 9 ? 1 : 0;
        if (x > 0) { x += 1; }
        if (x > 1) { x += 1; }
        if (x > 2) { x += 1; }
        if (x > 3) { x += 1; }
        if (x > 4) { x += 1; }
        if (x > 5) { x += 1; }
        return l(x);
    }

    public static int mixed(int x, int[] z) {
        var u = x > 0 && x < 10 || x == 99;
        var t = x > 1 ? 2 : 3;
        foreach (var i in z) { }
        for (;;) { break; }
        if (x == 1) { x += 1; }
        else if (x == 2) { x += 2; }
        else if (x == 3) { x += 3; }
        else if (x == 4) { x += 4; }
        return x;
    }

    public static int wide(int x) {
        switch (x) {
            case 1: return 1;
            case 2: return 2;
            case 3: return 3;
            case 4: return 4;
            default: break;
        }
        if (x > 10) { x += 1; }
        if (x > 11) { x += 1; }
        if (x > 12) { x += 1; }
        if (x > 13) { x += 1; }
        if (x > 14) { x += 1; }
        return x;
    }

    public static int sprawl(int x) {
        if (x == 1) { x += 1; }
        if (x == 2) { x += 1; }
        if (x == 3) { x += 1; }
        if (x == 4) { x += 1; }
        if (x == 5) { x += 1; }
        if (x == 6) { x += 1; }
        if (x == 7) { x += 1; }
        if (x == 8) { x += 1; }
        if (x == 9) { x += 1; }
        if (x == 10) { x += 1; }
        if (x == 11) { x += 1; }
        return x;
    }
}
