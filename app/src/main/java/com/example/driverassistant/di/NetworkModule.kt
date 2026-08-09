package com.example.driverassistant.di

import android.content.Context
import com.example.driverassistant.data.api.BackendApi
import com.example.driverassistant.data.api.MistralApi
import com.example.driverassistant.data.api.OsrmApi
import com.example.driverassistant.BuildConfig
import com.example.driverassistant.data.security.BackendClientFactory
import com.example.driverassistant.data.security.BackendDeviceCredentials
import com.example.driverassistant.data.security.DeviceCredentialStore
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import okhttp3.HttpUrl.Companion.toHttpUrl
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import javax.inject.Singleton
import java.util.concurrent.TimeUnit

@Module
@InstallIn(SingletonComponent::class)
object NetworkModule {

    @Provides
    @Singleton
    fun provideOkHttpClient(): OkHttpClient {
        val logging = HttpLoggingInterceptor().apply {
            level = HttpLoggingInterceptor.Level.BASIC
            redactHeader("x-device-id")
            redactHeader("x-device-token")
            redactHeader("x-driver-uuid")
            redactHeader("authorization")
            redactHeader("cookie")
            redactHeader("set-cookie")
        }
        return OkHttpClient.Builder()
            .addInterceptor(logging)
            .connectTimeout(60, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .writeTimeout(60, TimeUnit.SECONDS)
            .build()
    }

    @Provides
    @Singleton
    fun provideMistralApi(client: OkHttpClient): MistralApi {
        return Retrofit.Builder()
            .baseUrl("https://api.mistral.ai/")
            .addConverterFactory(GsonConverterFactory.create())
            .client(client)
            .build()
            .create(MistralApi::class.java)
    }

    @Provides
    @Singleton
    fun provideBackendApi(@ApplicationContext context: Context, client: OkHttpClient): BackendApi {
        val credentialStore = DeviceCredentialStore(context).also { it.migrateLegacyTokenIfNeeded() }
        val backendBaseUrl = BuildConfig.NDP_BACKEND_BASE_URL.toHttpUrl()
        val backendClient = BackendClientFactory.create(client, backendBaseUrl) {
            val prefs = context.getSharedPreferences("driver_prefs", Context.MODE_PRIVATE)
            BackendDeviceCredentials(
                deviceId = prefs.getString("device_id", null),
                deviceToken = credentialStore.getDeviceToken(),
                driverUuid = prefs.getString("driver_uuid", null)
            )
        }
        return Retrofit.Builder()
            .baseUrl(BuildConfig.NDP_BACKEND_BASE_URL)
            .addConverterFactory(GsonConverterFactory.create())
            .client(backendClient)
            .build()
            .create(BackendApi::class.java)
    }

    @Provides
    @Singleton
    fun provideOsrmApi(client: OkHttpClient): OsrmApi {
        return Retrofit.Builder()
            .baseUrl("https://router.project-osrm.org/")
            .addConverterFactory(GsonConverterFactory.create())
            .client(client)
            .build()
            .create(OsrmApi::class.java)
    }
}
