package com.ndp.agent

import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertEquals

class NdpAgentTest {
    @Test
    fun failedSendLeavesEventQueuedWithoutThrowing() {
        NdpAgent.initialize(
            configuration = NdpConfiguration(
                endpoint = "http://127.0.0.1:4000/api/ingest/events",
                projectId = "project_test",
                ingestKey = "test",
                environment = "development",
                maxQueueSize = 2,
                maxRetries = 1,
            ),
            transport = object : NdpTransport {
                override fun send(configuration: NdpConfiguration, body: String): Boolean = false
            },
        )

        NdpAgent.track(eventType = "BUTTON_CLICKED", title = "Save button clicked")
        Thread.sleep(200)

        assertEquals(1, NdpAgent.queuedCount())
    }

    @Test
    fun trackAttachesDefaultRuntimeVersionMetadataWithEventOverride() {
        var sentBody = ""
        NdpAgent.initialize(
            configuration = NdpConfiguration(
                endpoint = "http://127.0.0.1:4000/api/ingest/events",
                projectId = "project_test",
                ingestKey = "test",
                environment = "development",
                appVersion = "1.2.3",
                buildNumber = "42",
                commitSha = "abc1234",
                serviceName = "LogiHERO",
                buildOrigin = "local",
            ),
            transport = object : NdpTransport {
                override fun send(configuration: NdpConfiguration, body: String): Boolean {
                    sentBody = body
                    return true
                }
            },
        )

        NdpAgent.track(
            eventType = "BUTTON_CLICKED",
            title = "Save button clicked",
            runtimeVersion = mapOf("deployId" to "deploy-local", "commitSha" to "def5678"),
        )
        Thread.sleep(200)

        assertContains(sentBody, "\"runtimeVersion\"")
        assertContains(sentBody, "\"projectId\":\"project_test\"")
        assertContains(sentBody, "\"appVersion\":\"1.2.3\"")
        assertContains(sentBody, "\"buildNumber\":\"42\"")
        assertContains(sentBody, "\"commitSha\":\"def5678\"")
        assertContains(sentBody, "\"deployId\":\"deploy-local\"")
        assertContains(sentBody, "\"serviceName\":\"LogiHERO\"")
        assertContains(sentBody, "\"buildOrigin\":\"local\"")
    }
}
