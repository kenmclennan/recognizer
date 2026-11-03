package corpus

import kotlin.test.Test
import kotlin.test.assertEquals

class RiskTest {
    @Test
    fun smallFunctions() {
        assertEquals(2, straight(1))
        assertEquals(1, oneIf(true))
        assertEquals("one", ifElse(1))
        assertEquals(4, loops(listOf(1, 2), 2))
    }

    @Test
    fun largerFunctions() {
        assertEquals("a", whenThree(1, false))
        assertEquals(0, tryCatch(listOf(), false, false))
        assertEquals(1, booleans(true, true, false, listOf()))
    }
}
