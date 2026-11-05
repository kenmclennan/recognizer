package p

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test

class OuterTest {
    @Test
    fun outer() = assertEquals(3, Calc.add(1, 2))

    @Nested
    inner class InnerTest {
        @Test
        fun inner() = assertEquals(6, Calc.mul(2, 3))
    }
}
