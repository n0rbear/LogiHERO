package com.example.driverassistant

import android.app.Application
import com.ndp.agent.NdpAgent
import com.ndp.agent.NdpConfiguration
import dagger.hilt.android.HiltAndroidApp

@HiltAndroidApp
class DriverAssistantApp : Application() {
    override fun onCreate() {
        super.onCreate()

        val endpoint = BuildConfig.NDP_INGEST_ENDPOINT
        val ingestKey = BuildConfig.NDP_INGEST_KEY
        val projectId = BuildConfig.NDP_PROJECT_ID
        if (endpoint.isNotBlank() && ingestKey.isNotBlank() && projectId.isNotBlank()) {
            NdpAgent.initialize(
                configuration = NdpConfiguration(
                    endpoint = endpoint,
                    projectId = projectId,
                    ingestKey = ingestKey,
                    environment = BuildConfig.NDP_ENVIRONMENT,
                    appVersion = BuildConfig.VERSION_NAME,
                    serviceName = BuildConfig.NDP_APP_NAME,
                    buildOrigin = if (BuildConfig.DEBUG) "debug" else "release"
                )
            )
        }
    }
}
