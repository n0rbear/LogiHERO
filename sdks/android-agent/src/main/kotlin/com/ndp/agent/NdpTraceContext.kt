package com.ndp.agent

data class NdpTraceContext(
    val traceId: String = NdpAgent.newTraceId(),
    val sessionId: String = NdpAgent.currentSessionId(),
) {
    fun headers(): Map<String, String> = mapOf("X-NDP-Trace-Id" to traceId)
}
