using Xunit;

namespace P.Tests
{
    public class MulTests
    {
        [Fact]
        public void Muls() => Assert.Equal(6, new Calc().Mul(2, 3));
    }

    public class NegTests
    {
        [Fact]
        public void Negs() => Assert.Equal(-1, new Calc().Neg(1));
    }
}
