package com.example.driverassistant.domain.model

import androidx.room.Entity
import androidx.room.PrimaryKey
import com.google.gson.annotations.SerializedName

@Entity(tableName = "hotels")
data class Hotel(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    @SerializedName("public_id")
    val publicId: String = java.util.UUID.randomUUID().toString(),
    @SerializedName("tour_id")
    val tourId: Long,
    @SerializedName("stop_id")
    val stopId: Long? = null,
    @SerializedName("driver_id")
    val driverId: Long? = null,
    @SerializedName("driver_name")
    val driverName: String? = null,
    val name: String,
    @SerializedName("address_line_1")
    val addressLine1: String,
    @SerializedName("address_line_2")
    val addressLine2: String? = null,
    @SerializedName("postal_code")
    val postalCode: String? = null,
    val city: String,
    val country: String? = null,
    val latitude: Double? = null,
    val longitude: Double? = null,
    val phone: String? = null,
    @SerializedName("booking_number")
    val bookingNumber: String? = null,
    @SerializedName("booking_provider")
    val bookingProvider: String? = null,
    @SerializedName("check_in_date")
    val checkInDate: String? = null,
    @SerializedName("check_in_time")
    val checkInTime: String? = null,
    @SerializedName("check_out_date")
    val checkOutDate: String? = null,
    @SerializedName("check_out_time")
    val checkOutTime: String? = null,
    @SerializedName("number_of_nights")
    val numberOfNights: Int? = null,
    @SerializedName("number_of_rooms")
    val numberOfRooms: Int? = null,
    val status: String = "PLANNED",
    val notes: String? = null,
    @SerializedName("street_view_url")
    val streetViewUrl: String? = null,
    @SerializedName("external_map_url")
    val externalMapUrl: String? = null,
    @SerializedName("created_at")
    val createdAt: Long = System.currentTimeMillis(),
    @SerializedName("updated_at")
    val updatedAt: Long = System.currentTimeMillis(),
    @SerializedName("deleted_at")
    val deletedAt: Long? = null,
    
    // Optional fields
    @SerializedName("contact_name")
    val contactName: String? = null,
    val email: String? = null,
    @SerializedName("reservation_name")
    val reservationName: String? = null,
    @SerializedName("breakfast_included")
    val breakfastIncluded: Boolean = false,
    @SerializedName("parking_included")
    val parkingIncluded: Boolean = false,
    @SerializedName("late_check_in")
    val lateCheckIn: Boolean = false,
    @SerializedName("room_type")
    val roomType: String? = null,
    @SerializedName("room_number")
    val roomNumber: String? = null,
    @SerializedName("entry_code")
    val entryCode: String? = null
) {
    companion object {
        const val STATUS_PLANNED = "PLANNED"
        const val STATUS_BOOKED = "BOOKED"
        const val STATUS_CONFIRMED = "CONFIRMED"
        const val STATUS_CHECKED_IN = "CHECKED_IN"
        const val STATUS_CHECKED_OUT = "CHECKED_OUT"
        const val STATUS_CANCELLED = "CANCELLED"
        const val STATUS_PROBLEM = "PROBLEM"
    }
}

