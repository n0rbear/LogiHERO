package com.example.driverassistant.domain.model

import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey
import com.google.gson.annotations.SerializedName

@Entity(
    tableName = "cargo_events",
    foreignKeys = [
        ForeignKey(
            entity = Cargo::class,
            parentColumns = ["id"],
            childColumns = ["cargoId"],
            onDelete = ForeignKey.CASCADE
        )
    ],
    indices = [Index(value = ["cargoId"])]
)
data class CargoEvent(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    @SerializedName("cargo_id") val cargoId: Long,
    @SerializedName("event_type") val eventType: String,
    @SerializedName("from_status") val fromStatus: String? = null,
    @SerializedName("to_status") val toStatus: String? = null,
    @SerializedName("actor_type") val actorType: String? = null,
    @SerializedName("actor_id") val actorId: String? = null,
    @SerializedName("stop_id") val stopId: Long? = null,
    val timestamp: Long = System.currentTimeMillis(),
    val reason: String? = null,
    val metadata: String? = null // JSON string
)
