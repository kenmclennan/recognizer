package p

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class AddTest {
    @Test
    fun adds() = assertEquals(3, Calc.add(1, 2))
}
