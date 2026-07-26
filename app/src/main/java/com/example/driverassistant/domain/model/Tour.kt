package com.example.driverassistant.domain.model

import androidx.room.Entity
import androidx.room.PrimaryKey
import com.google.gson.annotations.SerializedName

@Entity(tableName = "tours")
data class Tour(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val uuid: String = java.util.UUID.randomUUID().toString(),
    @SerializedName("driver_name") val driverName: String = "Ismeretlen",
    val name: String,
    val customer: String = "",
    val date: Long,
    @SerializedName("day_of_week") val dayOfWeek: String? = null,
    val notes: String = "",
    @SerializedName("is_closed") val isClosed: Boolean = false,
    @SerializedName("is_current") val isCurrent: Boolean = false,
    @SerializedName("depot_name") val depotName: String = "",
    @SerializedName("depot_latitude") val depotLatitude: Double? = null,
    @SerializedName("depot_longitude") val depotLongitude: Double? = null,
    val vehicle: String = "",
    val trailer: String = "",
    @SerializedName("return_depot_name") val returnDepotName: String = "",
    @SerializedName("return_depot_address_full") val returnDepotAddressFull: String = "",
    @SerializedName("return_depot_lat") val returnDepotLat: Double? = null,
    @SerializedName("return_depot_lng") val returnDepotLng: Double? = null,
    @SerializedName("planned_start_at") val plannedStartAt: Long? = null,
    @SerializedName("planned_end_at") val plannedEndAt: Long? = null,
    @SerializedName("actual_start_at") val actualStartAt: Long? = null,
    @SerializedName("actual_end_at") val actualEndAt: Long? = null,
    @SerializedName("tour_status") val tourStatus: String = "PLANNED",
    @SerializedName("next_stop_id") val nextStopId: Long? = null,
    @SerializedName("planned_distance_km") val plannedDistanceKm: Double? = null,
    @SerializedName("planned_duration_seconds") val plannedDurationSeconds: Long? = null,
    @SerializedName("remaining_distance_km") val remainingDistanceKm: Double? = null,
    @SerializedName("remaining_duration_seconds") val remainingDurationSeconds: Long? = null,
    @SerializedName("completed_distance_km") val completedDistanceKm: Double? = null,
    @SerializedName("route_status") val routeStatus: String = "NOT_CALCULATED",
    @SerializedName("created_at") val createdAt: Long = System.currentTimeMillis(),
    @SerializedName("deleted_at") val deletedAt: Long? = null,
    @SerializedName("updated_at") val updatedAt: Long? = null,
    @SerializedName("sync_state") val syncState: String = "SYNCED",
    val revision: Int = 1
)
