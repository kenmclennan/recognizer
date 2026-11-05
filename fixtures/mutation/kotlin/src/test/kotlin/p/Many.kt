package p

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class MulTest {
    @Test
    fun muls() = assertEquals(6, Calc.mul(2, 3))
}

class NegTest {
    @Test
    fun negs() = assertEquals(-1, Calc.neg(1))
}
