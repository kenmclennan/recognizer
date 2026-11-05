using Xunit;

namespace P.Tests;

public class AddTests
{
    [Fact]
    public void Adds() => Assert.Equal(3, new Calc().Add(1, 2));
}
