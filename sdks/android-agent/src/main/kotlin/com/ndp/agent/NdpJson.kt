package com.ndp.agent

internal object NdpJson {
    fun event(event: NdpEvent, configuration: NdpConfiguration, sessionId: String): String =
        buildString {
            append("{")
            appendField("projectId", configuration.projectId)
            append(",")
            appendField("traceId", event.traceId)
            append(",")
            appendField("eventType", event.eventType)
            append(",")
            appendField("source", "ANDROID")
            append(",")
            appendField("severity", event.severity)
            append(",")
            appendField("title", event.title)
            event.description?.let {
                append(",")
                appendField("description", it)
            }
            append(",")
            append("\"payload\":")
            append(value(NdpRedactor.redact(event.payload) + mapOf(
                "ndpEnvironment" to configuration.environment,
                "ndpAppVersion" to configuration.appVersion,
                "ndpSessionId" to sessionId,
            )))
            runtimeVersion(event, configuration).takeIf { it.isNotEmpty() }?.let {
                append(",")
                append("\"runtimeVersion\":")
                append(value(it))
            }
            append(",")
            appendField("timestamp", event.timestamp)
            append("}")
        }

    private fun runtimeVersion(event: NdpEvent, configuration: NdpConfiguration): Map<String, String> =
        mapOf(
            "environment" to configuration.environment,
            "appVersion" to configuration.appVersion,
            "buildNumber" to configuration.buildNumber,
            "commitSha" to configuration.commitSha,
            "deployId" to configuration.deployId,
            "serviceName" to configuration.serviceName,
            "serviceId" to configuration.serviceId,
            "provider" to configuration.provider,
            "buildOrigin" to configuration.buildOrigin,
        ).plus(event.runtimeVersion)
            .mapValues { (_, value) -> value?.trim() }
            .filterValues { value -> !value.isNullOrEmpty() }
            .mapValues { (_, value) -> value.orEmpty() }

    private fun StringBuilder.appendField(key: String, value: String) {
        append("\"").append(escape(key)).append("\":\"").append(escape(value)).append("\"")
    }

    private fun value(value: Any?): String =
        when (value) {
            null -> "null"
            is String -> "\"${escape(value)}\""
            is Number, is Boolean -> value.toString()
            is Map<*, *> -> value.entries.joinToString(prefix = "{", postfix = "}") { (key, entryValue) ->
                "\"${escape(key.toString())}\":${value(entryValue)}"
            }
            is List<*> -> value.joinToString(prefix = "[", postfix = "]") { value(it) }
            else -> "\"${escape(value.toString())}\""
        }

    private fun escape(value: String): String =
        value.flatMap {
            when (it) {
                '\\' -> listOf('\\', '\\')
                '"' -> listOf('\\', '"')
                '\n' -> listOf('\\', 'n')
                '\r' -> listOf('\\', 'r')
                '\t' -> listOf('\\', 't')
                else -> listOf(it)
            }
        }.joinToString("")
}
