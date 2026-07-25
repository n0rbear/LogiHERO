package com.ndp.agent

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class NdpTraceContextTest {
    @Test
    fun exposesTraceHeader() {
        val context = NdpTraceContext(traceId = "trace-save-demo", sessionId = "session-demo")

        assertEquals("trace-save-demo", context.headers()["X-NDP-Trace-Id"])
        assertTrue(context.traceId.isNotBlank())
    }
}
