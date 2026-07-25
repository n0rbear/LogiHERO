package com.ndp.agent

object NdpRedactor {
    private val sensitivePattern = Regex("(password|token|authorization|secret|apiKey|api_key|accessKey|access_key)", RegexOption.IGNORE_CASE)

    fun redact(payload: Map<String, Any?>): Map<String, Any?> =
        payload.mapValues { (key, value) ->
            if (sensitivePattern.containsMatchIn(key)) {
                "[REDACTED]"
            } else {
                redactValue(value)
            }
        }

    @Suppress("UNCHECKED_CAST")
    private fun redactValue(value: Any?): Any? =
        when (value) {
            is Map<*, *> -> redact(value as Map<String, Any?>)
            is List<*> -> value.map { redactValue(it) }
            else -> value
        }
}
