package com.example.driverassistant.data.api

import com.google.gson.JsonArray
import com.google.gson.JsonObject
import com.google.gson.annotations.SerializedName

data class DeltaSyncResponse(
    @SerializedName("serverTime") val serverTime: Long,
    val changes: Map<String, JsonArray> = emptyMap()
)

data class DeltaSyncRequest(
    val changes: Map<String, List<JsonObject>>
)

data class DeltaSyncApplyResponse(
    val success: Boolean = true,
    @SerializedName("serverTime") val serverTime: Long,
    val applied: Map<String, JsonArray> = emptyMap(),
    val rejected: List<SyncRejectedRecord> = emptyList()
)

data class SyncRejectedRecord(
    val entity: String,
    val uuid: String? = null,
    val error: String
)

data class SyncConflictResponse(
    val error: String,
    val conflicts: List<SyncConflict> = emptyList(),
    @SerializedName("serverTime") val serverTime: Long? = null
)

data class SyncConflict(
    val entity: String,
    val uuid: String,
    val server: JsonObject,
    @SerializedName("serverRevision") val serverRevision: Int? = null
)

data class SyncVersionResponse(
    val version: Long,
    @SerializedName("serverTime") val serverTime: Long
)
