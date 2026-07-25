package com.ndp.agent

import java.net.HttpURLConnection
import java.net.URI

class HttpNdpTransport : NdpTransport {
    override fun send(configuration: NdpConfiguration, body: String): Boolean =
        runCatching {
            val connection = URI(configuration.endpoint).toURL().openConnection() as HttpURLConnection
            connection.requestMethod = "POST"
            connection.connectTimeout = configuration.timeoutMillis
            connection.readTimeout = configuration.timeoutMillis
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json")
            connection.setRequestProperty("X-NDP-Project-Id", configuration.projectId)
            connection.setRequestProperty("X-NDP-Ingest-Key", configuration.ingestKey)
            connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            connection.responseCode in 200..299
        }.getOrDefault(false)
}
