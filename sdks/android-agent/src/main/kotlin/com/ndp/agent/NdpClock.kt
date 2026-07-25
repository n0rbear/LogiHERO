package com.ndp.agent

import java.time.Instant

object NdpClock {
    fun nowIso(): String = Instant.now().toString()
}
