package com.example.driverassistant.data.security

import okhttp3.HttpUrl
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.Response
import java.util.UUID

internal data class BackendDeviceCredentials(
    val deviceId: String?,
    val deviceToken: String?,
    val driverUuid: String?
)

internal class BackendCredentialInterceptor(
    backendBaseUrl: HttpUrl,
    private val credentialProvider: () -> BackendDeviceCredentials
) : Interceptor {
    private val backendScheme = backendBaseUrl.scheme
    private val backendHost = backendBaseUrl.host
    private val backendPort = backendBaseUrl.port

    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        val builder = request.newBuilder()
            .removeHeader(DEVICE_ID_HEADER)
            .removeHeader(DEVICE_TOKEN_HEADER)
            .removeHeader(DRIVER_UUID_HEADER)

        if (isBackendOrigin(request.url)) {
            val credentials = credentialProvider()
            credentials.deviceId?.let { builder.header(DEVICE_ID_HEADER, it) }
            credentials.deviceToken?.let { builder.header(DEVICE_TOKEN_HEADER, it) }
            credentials.driverUuid?.let { builder.header(DRIVER_UUID_HEADER, it) }
        }

        return chain.proceed(builder.build())
    }

    private fun isBackendOrigin(url: HttpUrl): Boolean =
        url.scheme == backendScheme && url.host == backendHost && url.port == backendPort

    private companion object {
        const val DEVICE_ID_HEADER = "x-device-id"
        const val DEVICE_TOKEN_HEADER = "x-device-token"
        const val DRIVER_UUID_HEADER = "x-driver-uuid"
    }
}

internal object BackendClientFactory {
    fun create(
        baseClient: OkHttpClient,
        backendBaseUrl: HttpUrl,
        credentialProvider: () -> BackendDeviceCredentials
    ): OkHttpClient = baseClient.newBuilder()
        .followRedirects(false)
        .followSslRedirects(false)
        .addInterceptor { chain ->
            val request = chain.request().newBuilder()
                .header("x-request-id", UUID.randomUUID().toString())
                .build()
            chain.proceed(request)
        }
        .addNetworkInterceptor(BackendCredentialInterceptor(backendBaseUrl, credentialProvider))
        .build()
}
