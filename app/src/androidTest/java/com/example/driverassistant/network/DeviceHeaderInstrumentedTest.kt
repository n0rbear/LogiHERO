package com.example.driverassistant.network

import android.content.Context
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.example.driverassistant.data.security.DeviceCredentialStore
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.logging.HttpLoggingInterceptor
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class DeviceHeaderInstrumentedTest {
    private lateinit var context: Context
    private lateinit var server: MockWebServer
    private val logs = mutableListOf<String>()

    @Before
    fun setUp() {
        context = InstrumentationRegistry.getInstrumentation().targetContext
        context.getSharedPreferences("driver_prefs", Context.MODE_PRIVATE).edit().clear().commit()
        context.getSharedPreferences("device_credentials", Context.MODE_PRIVATE).edit().clear().commit()
        server = MockWebServer()
        server.start()
        logs.clear()
    }

    @After
    fun tearDown() {
        server.shutdown()
        DeviceCredentialStore(context).clear()
    }

    @Test
    fun sendsRequiredDeviceHeadersWhenCredentialExists() {
        context.getSharedPreferences("driver_prefs", Context.MODE_PRIVATE).edit()
            .putString("device_id", "device-1")
            .putString("driver_uuid", "11111111-1111-4111-8111-111111111111")
            .commit()
        DeviceCredentialStore(context).saveDeviceToken("token-1")
        server.enqueue(MockResponse().setResponseCode(200).setBody("{}"))

        client().newCall(Request.Builder().url(server.url("/probe")).build()).execute().close()
        val request = server.takeRequest()
        assertEquals("device-1", request.getHeader("x-device-id"))
        assertEquals("token-1", request.getHeader("x-device-token"))
        assertEquals("11111111-1111-4111-8111-111111111111", request.getHeader("x-driver-uuid"))
        assertNotNull(request.getHeader("x-request-id"))
    }

    @Test
    fun omitsTokenHeaderWhenCredentialMissing() {
        context.getSharedPreferences("driver_prefs", Context.MODE_PRIVATE).edit()
            .putString("device_id", "device-1")
            .putString("driver_uuid", "11111111-1111-4111-8111-111111111111")
            .commit()
        server.enqueue(MockResponse().setResponseCode(401).setBody("{}"))

        client().newCall(Request.Builder().url(server.url("/probe")).build()).execute().close()
        val request = server.takeRequest()
        assertEquals("device-1", request.getHeader("x-device-id"))
        assertEquals(null, request.getHeader("x-device-token"))
    }

    @Test
    fun loggingRedactsSensitiveHeaders() {
        context.getSharedPreferences("driver_prefs", Context.MODE_PRIVATE).edit()
            .putString("device_id", "device-1")
            .putString("driver_uuid", "11111111-1111-4111-8111-111111111111")
            .commit()
        DeviceCredentialStore(context).saveDeviceToken("secret-token")
        server.enqueue(MockResponse().setResponseCode(403).setBody("{}"))

        client().newCall(
            Request.Builder()
                .url(server.url("/probe"))
                .header("Authorization", "Bearer hidden")
                .header("Cookie", "admin_session=hidden")
                .build()
        ).execute().close()

        val joined = logs.joinToString("\n")
        assertFalse(joined.contains("secret-token"))
        assertFalse(joined.contains("Bearer hidden"))
        assertFalse(joined.contains("admin_session=hidden"))
        assertTrue(joined.contains("x-device-token:"))
    }

    private fun client(): OkHttpClient {
        val credentialStore = DeviceCredentialStore(context).also { it.migrateLegacyTokenIfNeeded() }
        val logging = HttpLoggingInterceptor { logs.add(it) }.apply {
            level = HttpLoggingInterceptor.Level.HEADERS
            redactHeader("x-device-token")
            redactHeader("authorization")
            redactHeader("cookie")
            redactHeader("set-cookie")
        }
        return OkHttpClient.Builder()
            .addInterceptor { chain ->
                val prefs = context.getSharedPreferences("driver_prefs", Context.MODE_PRIVATE)
                val builder = chain.request().newBuilder()
                    .header("x-request-id", UUID.randomUUID().toString())
                prefs.getString("device_id", null)?.let { builder.header("x-device-id", it) }
                credentialStore.getDeviceToken()?.let { builder.header("x-device-token", it) }
                prefs.getString("driver_uuid", null)?.let { builder.header("x-driver-uuid", it) }
                chain.proceed(builder.build())
            }
            .addInterceptor(logging)
            .build()
    }
}
