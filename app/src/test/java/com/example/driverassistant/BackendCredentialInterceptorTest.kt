package com.example.driverassistant

import com.example.driverassistant.data.security.BackendClientFactory
import com.example.driverassistant.data.security.BackendDeviceCredentials
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import java.util.concurrent.TimeUnit

class BackendCredentialInterceptorTest {
    private lateinit var backend: MockWebServer
    private lateinit var thirdParty: MockWebServer

    @Before
    fun setUp() {
        backend = MockWebServer().also { it.start() }
        thirdParty = MockWebServer().also { it.start() }
    }

    @After
    fun tearDown() {
        backend.shutdown()
        thirdParty.shutdown()
    }

    @Test
    fun backendOriginReceivesDeviceCredentials() {
        backend.enqueue(MockResponse().setResponseCode(200).setBody("{}"))

        credentialClient().newCall(Request.Builder().url(backend.url("/api/probe")).build()).execute().close()

        val request = backend.takeRequest()
        assertEquals("device-1", request.getHeader("x-device-id"))
        assertEquals("token-1", request.getHeader("x-device-token"))
        assertEquals(DRIVER_UUID, request.getHeader("x-driver-uuid"))
        assertRequestIdPresent(request)
    }

    @Test
    fun thirdPartyOriginDoesNotReceiveDeviceCredentials() {
        var credentialReads = 0
        thirdParty.enqueue(MockResponse().setResponseCode(200).setBody("{}"))

        credentialClient {
            credentialReads += 1
            credentials()
        }.newCall(
            Request.Builder()
                .url(thirdParty.url("/route"))
                .header("x-device-id", "spoofed-device")
                .header("x-device-token", "spoofed-token")
                .header("x-driver-uuid", "spoofed-driver")
                .build()
        ).execute().close()

        assertNoDeviceCredentials(thirdParty.takeRequest())
        assertEquals(0, credentialReads)
    }

    @Test
    fun credentialBearingClientDoesNotFollowRedirects() {
        backend.enqueue(
            MockResponse()
                .setResponseCode(307)
                .addHeader("Location", thirdParty.url("/redirect-target"))
        )

        val client = credentialClient()
        val response = client.newCall(Request.Builder().url(backend.url("/redirect")).build()).execute()

        response.use { assertEquals(307, it.code) }
        val firstRequest = backend.takeRequest()
        assertEquals("token-1", firstRequest.getHeader("x-device-token"))
        assertNull(thirdParty.takeRequest(200, TimeUnit.MILLISECONDS))
        assertFalse(client.followRedirects)
        assertFalse(client.followSslRedirects)
    }

    @Test
    fun derivingBackendClientDoesNotMutateSharedExternalClient() {
        val baseClient = OkHttpClient.Builder().build()
        credentialClient(baseClient)
        thirdParty.enqueue(
            MockResponse()
                .setResponseCode(307)
                .addHeader("Location", backend.url("/redirect-target"))
        )
        backend.enqueue(MockResponse().setResponseCode(200).setBody("{}"))

        baseClient.newCall(Request.Builder().url(thirdParty.url("/redirect")).build()).execute().close()

        thirdParty.takeRequest()
        val redirectedRequest = backend.takeRequest()
        assertNoDeviceCredentials(redirectedRequest)
        assertNull(redirectedRequest.getHeader("x-request-id"))
        assertEquals(true, baseClient.followRedirects)
    }

    private fun credentialClient(baseClient: OkHttpClient = OkHttpClient.Builder().build()): OkHttpClient =
        BackendClientFactory.create(baseClient, backend.url("/")) { credentials() }

    private fun credentialClient(credentialProvider: () -> BackendDeviceCredentials): OkHttpClient =
        BackendClientFactory.create(OkHttpClient.Builder().build(), backend.url("/"), credentialProvider)

    private fun credentials(): BackendDeviceCredentials = BackendDeviceCredentials(
        deviceId = "device-1",
        deviceToken = "token-1",
        driverUuid = DRIVER_UUID
    )

    private fun assertNoDeviceCredentials(request: okhttp3.mockwebserver.RecordedRequest) {
        assertNull(request.getHeader("x-device-id"))
        assertNull(request.getHeader("x-device-token"))
        assertNull(request.getHeader("x-driver-uuid"))
    }

    private fun assertRequestIdPresent(request: okhttp3.mockwebserver.RecordedRequest) {
        val value = request.getHeader("x-request-id")
        assertEquals(36, value?.length)
    }

    private companion object {
        const val DRIVER_UUID = "11111111-1111-4111-8111-111111111111"
    }
}
