package com.example.driverassistant.domain.model

import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey
import com.google.gson.annotations.SerializedName

@Entity(
    tableName = "cargo",
    foreignKeys = [
        ForeignKey(
            entity = Tour::class,
            parentColumns = ["id"],
            childColumns = ["tourId"],
            onDelete = ForeignKey.CASCADE
        )
    ],
    indices = [Index(value = ["tourId"]), Index(value = ["uuid"], unique = true)]
)
data class Cargo(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val uuid: String = java.util.UUID.randomUUID().toString(),
    @SerializedName("tour_id") val tourId: Long,
    @SerializedName("pickup_stop_id") val pickupStopId: Long? = null,
    @SerializedName("delivery_stop_id") val deliveryStopId: Long? = null,
    @SerializedName("pickup_stop_uuid") val pickupStopUuid: String? = null,
    @SerializedName("delivery_stop_uuid") val deliveryStopUuid: String? = null,
    val type: String = "MACHINE", // MACHINE, PALLET, BOX, PART, VEHICLE, EQUIPMENT, OTHER
    val name: String,
    val description: String? = null,
    val quantity: Int = 1,
    val unit: String = "pcs",
    @SerializedName("serial_number") val serialNumber: String? = null,
    @SerializedName("external_reference") val externalReference: String? = null,
    @SerializedName("customer_reference") val customerReference: String? = null,
    @SerializedName("weight_kg") val weightKg: Double? = null,
    @SerializedName("length_cm") val lengthCm: Double? = null,
    @SerializedName("width_cm") val widthCm: Double? = null,
    @SerializedName("height_cm") val heightCm: Double? = null,
    val status: String = "PLANNED", // PLANNED, READY_FOR_PICKUP, PICKED_UP, IN_TRANSIT, DELIVERED, REJECTED, DAMAGED, MISSING, CANCELLED
    @SerializedName("condition_at_pickup") val conditionAtPickup: String? = null,
    @SerializedName("condition_at_delivery") val conditionAtDelivery: String? = null,
    val notes: String? = null,
    @SerializedName("driver_name") val driverName: String? = null,
    @SerializedName("created_at") val createdAt: Long = System.currentTimeMillis(),
    @SerializedName("updated_at") val updatedAt: Long = System.currentTimeMillis(),
    @SerializedName("deleted_at") val deletedAt: Long? = null,
    @SerializedName("sync_state") val syncState: String = "SYNCED",
    val revision: Int = 1
)
