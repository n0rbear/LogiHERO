package com.example.driverassistant.data.sync

import android.util.Log
import com.example.driverassistant.data.api.BackendApi
import com.example.driverassistant.data.api.DeltaSyncApplyResponse
import com.example.driverassistant.data.api.DeltaSyncRequest
import com.example.driverassistant.data.api.DeltaSyncResponse
import com.example.driverassistant.data.api.SyncConflictResponse
import com.google.gson.Gson
import com.google.gson.JsonObject
import retrofit2.HttpException
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.math.min
import kotlinx.coroutines.delay

sealed class DeltaSyncResult {
    data class Success(
        val pulled: DeltaSyncResponse,
        val pushed: DeltaSyncApplyResponse?,
        val partial: Boolean = false
    ) : DeltaSyncResult()

    data class Conflict(val conflict: SyncConflictResponse) : DeltaSyncResult()
    data class Failed(val error: Throwable) : DeltaSyncResult()
}

@Singleton
class DeltaSyncEngine @Inject constructor(
    private val backendApi: BackendApi
) {
    private val gson = Gson()

    suspend fun sync(
        since: Long,
        pendingChanges: Map<String, List<JsonObject>>,
        maxAttempts: Int = 3
    ): DeltaSyncResult {
        return retryWithBackoff(maxAttempts) {
            val pulled = backendApi.getDeltaSync(since)
            val pushed = if (pendingChanges.values.any { it.isNotEmpty() }) {
                backendApi.postDeltaSync(DeltaSyncRequest(pendingChanges))
            } else {
                null
            }
            DeltaSyncResult.Success(
                pulled = pulled,
                pushed = pushed,
                partial = pushed?.rejected?.isNotEmpty() == true
            )
        }
    }

    private suspend fun retryWithBackoff(
        maxAttempts: Int,
        block: suspend () -> DeltaSyncResult
    ): DeltaSyncResult {
        var delayMs = 500L
        var lastError: Throwable? = null
        repeat(maxAttempts) { attempt ->
            try {
                return block()
            } catch (error: HttpException) {
                if (error.code() == 409) {
                    val body = error.response()?.errorBody()?.string()
                    val conflict = runCatching {
                        gson.fromJson(body, SyncConflictResponse::class.java)
                    }.getOrElse {
                        SyncConflictResponse(error = "SYNC_CONFLICT")
                    }
                    return DeltaSyncResult.Conflict(conflict)
                }
                lastError = error
                if (error.code() in 400..499) return DeltaSyncResult.Failed(error)
            } catch (error: IOException) {
                lastError = error
            }

            if (attempt < maxAttempts - 1) {
                Log.w("DeltaSync", "Sync attempt ${attempt + 1} failed, retrying")
                delay(delayMs)
                delayMs = min(delayMs * 2, 5000L)
            }
        }
        return DeltaSyncResult.Failed(lastError ?: IllegalStateException("Sync failed"))
    }
}
