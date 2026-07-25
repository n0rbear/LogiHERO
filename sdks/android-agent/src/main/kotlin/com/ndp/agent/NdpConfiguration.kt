package com.ndp.agent

data class NdpConfiguration(
    val endpoint: String,
    val projectId: String,
    val ingestKey: String,
    val environment: String,
    val appVersion: String = "unknown",
    val buildNumber: String? = null,
    val commitSha: String? = null,
    val deployId: String? = null,
    val serviceName: String? = null,
    val serviceId: String? = null,
    val provider: String? = null,
    val buildOrigin: String? = null,
    val timeoutMillis: Int = 5_000,
    val maxQueueSize: Int = 100,
    val maxRetries: Int = 2,
)
