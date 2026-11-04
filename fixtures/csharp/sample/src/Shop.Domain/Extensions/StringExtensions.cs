namespace Shop.Domain.Extensions;

public static class StringExtensions
{
    public static string Shout(this string text) => text.ToUpperInvariant();
}
