package com.example.driverassistant.domain.model

import androidx.room.Entity
import androidx.room.PrimaryKey
import com.google.gson.annotations.SerializedName

@Entity(tableName = "hotel_events")
data class HotelEvent(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    @SerializedName("hotel_id")
    val hotelId: Long,
    @SerializedName("event_type")
    val eventType: String,
    @SerializedName("from_status")
    val fromStatus: String? = null,
    @SerializedName("to_status")
    val toStatus: String? = null,
    @SerializedName("actor_type")
    val actorType: String = "DRIVER",
    @SerializedName("actor_id")
    val actorId: String,
    val timestamp: Long = System.currentTimeMillis(),
    val reason: String? = null,
    @SerializedName("client_event_id")
    val clientEventId: String = java.util.UUID.randomUUID().toString(),
    val metadata: String? = null, // JSON string
    @SerializedName("is_synced")
    val isSynced: Boolean = false
)
