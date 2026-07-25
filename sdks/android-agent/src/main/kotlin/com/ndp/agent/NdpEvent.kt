package com.ndp.agent

data class NdpEvent(
    val traceId: String,
    val eventType: String,
    val severity: String = "INFO",
    val title: String,
    val description: String? = null,
    val payload: Map<String, Any?> = emptyMap(),
    val runtimeVersion: Map<String, String?> = emptyMap(),
    val timestamp: String = NdpClock.nowIso(),
)
