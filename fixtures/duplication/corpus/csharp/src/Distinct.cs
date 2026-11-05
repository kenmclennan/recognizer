public static class Distinct
{
    public static Dictionary<string, string> ReadConfig(string path)
    {
        var text = File.ReadAllText(path);
        var values = new Dictionary<string, string>();
        foreach (var row in text.Split('\n'))
        {
            var parts = row.Split('=', 2);
            values[parts[0].Trim()] = parts.Length > 1 ? parts[1].Trim() : "";
        }
        return values;
    }

    public static string RenderTable(List<List<string>> rows, List<int> widths)
    {
        var lines = new List<string>();
        rows.ForEach(row =>
        {
            var cells = row.Select((cell, position) => cell.PadRight(widths[position]));
            lines.Add(string.Join(" | ", cells));
        });
        return string.Join("\n", lines);
    }

    public static int WalkTree(TreeNode node, Action<TreeNode> visit)
    {
        var stack = new Stack<TreeNode>();
        stack.Push(node);
        while (stack.Count > 0)
        {
            var current = stack.Pop();
            visit(current);
            foreach (var child in Enumerable.Reverse(current.Children))
            {
                stack.Push(child);
            }
        }
        return stack.Count;
    }

    public static int ClampRange(int low, int high, int value)
    {
        var lower = Math.Min(low, high);
        var upper = Math.Max(low, high);
        return value switch
        {
            var v when v < lower => lower,
            var v when v > upper => upper,
            _ => value,
        };
    }

    public static (HashSet<string>, List<string>) ParseFlags(List<string> argv)
    {
        var flags = new HashSet<string>();
        var rest = new List<string>();
        foreach (var token in argv)
        {
            if (token.StartsWith("--"))
            {
                flags.Add(token.Substring(2));
            }
            else
            {
                rest.Add(token);
            }
        }
        return (flags, rest);
    }

    public static List<int> MergeSorted(List<int> left, List<int> right)
    {
        var merged = new List<int>();
        var i = 0;
        var j = 0;
        while (i < left.Count && j < right.Count)
        {
            if (left[i] <= right[j])
            {
                merged.Add(left[i++]);
            }
            else
            {
                merged.Add(right[j++]);
            }
        }
        merged.AddRange(left.Skip(i));
        merged.AddRange(right.Skip(j));
        return merged;
    }
}
