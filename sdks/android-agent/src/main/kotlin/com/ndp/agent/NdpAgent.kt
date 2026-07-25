package com.ndp.agent

import java.util.ArrayDeque
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

object NdpAgent {
    private val executor = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "ndp-agent").apply { isDaemon = true }
    }
    private val flushing = AtomicBoolean(false)
    private val queue = ArrayDeque<QueuedEvent>()
    private var configuration: NdpConfiguration? = null
    private var transport: NdpTransport = HttpNdpTransport()
    private var sessionId: String = UUID.randomUUID().toString()

    fun initialize(configuration: NdpConfiguration, transport: NdpTransport = HttpNdpTransport()) {
        runCatching {
            this.configuration = configuration
            this.transport = transport
            this.sessionId = UUID.randomUUID().toString()
            flushing.set(false)
            synchronized(queue) {
                queue.clear()
            }
        }
    }

    fun newTraceId(): String = UUID.randomUUID().toString()

    fun currentSessionId(): String = sessionId

    fun track(
        eventType: String,
        title: String,
        traceId: String = newTraceId(),
        severity: String = "INFO",
        description: String? = null,
        payload: Map<String, Any?> = emptyMap(),
        runtimeVersion: Map<String, String?> = emptyMap(),
    ) {
        val activeConfiguration = configuration ?: return
        runCatching {
            synchronized(queue) {
                if (queue.size >= activeConfiguration.maxQueueSize) {
                    queue.removeFirst()
                }
                queue.addLast(
                    QueuedEvent(
                        event = NdpEvent(
                            traceId = traceId,
                            eventType = eventType,
                            severity = severity,
                            title = title,
                            description = description,
                            payload = payload,
                            runtimeVersion = runtimeVersion,
                        ),
                    ),
                )
            }
            flushAsync()
        }
    }

    fun flushAsync() {
        val activeConfiguration = configuration ?: return
        if (!flushing.compareAndSet(false, true)) return

        executor.execute {
            try {
                flush(activeConfiguration)
            } catch (_: Throwable) {
            } finally {
                flushing.set(false)
            }
        }
    }

    internal fun queuedCount(): Int = synchronized(queue) { queue.size }

    private fun flush(activeConfiguration: NdpConfiguration) {
        while (true) {
            val queued = synchronized(queue) { queue.firstOrNull() } ?: return
            val body = NdpJson.event(queued.event, activeConfiguration, sessionId)
            val sent = runCatching { transport.send(activeConfiguration, body) }.getOrDefault(false)
            var shouldStop = false

            synchronized(queue) {
                if (queue.firstOrNull() !== queued) {
                    shouldStop = true
                    return@synchronized
                }
                if (sent || queued.attempts >= activeConfiguration.maxRetries) {
                    queue.removeFirst()
                } else {
                    queue.removeFirst()
                    queue.addLast(queued.copy(attempts = queued.attempts + 1))
                    shouldStop = true
                }
            }
            if (shouldStop) return
        }
    }

    private data class QueuedEvent(
        val event: NdpEvent,
        val attempts: Int = 0,
    )
}
