# NDP Android Agent SDK

Minimal Kotlin SDK foundation for sending Android application events to NDP.

This module is dependency-light by design. It uses a background executor, `HttpURLConnection`, bounded in-memory queueing, retry limits, and payload redaction.

The first Android app integration should wrap this module in the host application's build and call:

```kotlin
NdpAgent.initialize(
    configuration = NdpConfiguration(
        endpoint = "http://192.168.1.20:4000/api/ingest/events",
        projectId = "project_...",
        ingestKey = "ndp_ingest_...",
        environment = "development",
        appVersion = "1.0.0"
    )
)
```

Then track events:

```kotlin
val traceId = NdpAgent.newTraceId()

NdpAgent.track(
    eventType = "BUTTON_CLICKED",
    title = "Save button clicked",
    traceId = traceId,
    payload = mapOf("screen" to "VehicleEdit")
)
```

On a real Android phone, `localhost` is the phone itself. Use the computer's local network IP address or a tunnel.
