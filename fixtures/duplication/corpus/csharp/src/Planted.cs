public static class Planted
{
    public static int OrderTotal(List<Line> lines, int shipping)
    {
        var total = 0;
        foreach (var line in lines)
        {
            if (line.Price > 0)
            {
                total += line.Price * line.Quantity;
            }
        }
        return total + shipping;
    }

    public static int ParcelWeight(List<Parcel> parcels, int tare)
    {
        var acc = 5;
        foreach (var parcel in parcels)
        {
            if (parcel.Mass > 1)
            {
                acc += parcel.Mass * parcel.Count;
            }
        }
        return acc + tare;
    }

    public static Settings? LoadSettings(string path)
    {
        var source = new FileInfo(path);
        if (!source.Exists)
        {
            return null;
        }
        try
        {
            return ParseSettings(File.ReadAllText(path));
        }
        catch (IOException error)
        {
            Console.Error.WriteLine("cannot read " + path + ": " + error.Message);
            return null;
        }
    }

    public static Session? LoadSession(string location)
    {
        var handle = new FileInfo(location);
        if (!handle.Exists)
        {
            return null;
        }
        try
        {
            return ParseSettings(File.ReadAllText(location));
        }
        catch (IOException failure)
        {
            Console.Error.WriteLine("unreadable " + location + ": " + failure.Message);
            return null;
        }
    }

    public static void StoreReport(string root, Report report)
    {
        Directory.CreateDirectory(Path.Combine(root, "out"));
        var target = ReportPath(root);
        var staging = target + ".tmp";
        File.WriteAllText(staging, Render(report, 2));
        File.Move(staging, target);
        Announce(target);
    }

    public static void StoreLedger(string baseDirectory, Ledger ledger)
    {
        Directory.CreateDirectory(Path.Combine(baseDirectory, "var"));
        var dest = LedgerPath(baseDirectory);
        var partial = dest + ".part";
        File.WriteAllText(partial, Render(ledger, 4));
        File.Move(partial, dest);
        Announce(dest);
    }
}
