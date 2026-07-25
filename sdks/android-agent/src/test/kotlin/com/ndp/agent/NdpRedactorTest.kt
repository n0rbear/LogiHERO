package com.ndp.agent

import kotlin.test.Test
import kotlin.test.assertEquals

class NdpRedactorTest {
    @Test
    fun redactsSensitiveKeys() {
        val redacted = NdpRedactor.redact(
            mapOf(
                "screen" to "VehicleEdit",
                "password" to "secret",
                "nested" to mapOf("token" to "abc"),
            ),
        )

        assertEquals("VehicleEdit", redacted["screen"])
        assertEquals("[REDACTED]", redacted["password"])
        assertEquals("[REDACTED]", (redacted["nested"] as Map<*, *>)["token"])
    }
}
