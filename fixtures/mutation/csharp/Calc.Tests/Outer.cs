using Xunit;

namespace P.Tests;

public class OuterTests
{
    [Fact]
    public void Outer() => Assert.Equal(3, new Calc().Add(1, 2));

    public class InnerTests
    {
        [Fact]
        public void Inner() => Assert.Equal(6, new Calc().Mul(2, 3));
    }
}
