package com.example.driverassistant.domain.model

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey
import com.google.gson.annotations.SerializedName

@Entity(
    tableName = "work_times",
    indices = [Index(value = ["driverName", "startTime"], unique = true)]
)
data class WorkTime(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val uuid: String = java.util.UUID.randomUUID().toString(),
    val workDayUuid: String? = null,
    val driverName: String = "Ismeretlen",
    val type: String, // Munka, Vezetés, Pihenő, Rakodás
    val status: String = "WORK",
    val startTime: Long,
    val endTime: Long? = null,
    val durationMs: Long = if (endTime != null) endTime - startTime else 0,
    val source: String = "ANDROID",
    val manualEdit: Boolean = false,
    val correctionReason: String? = null,
    val approvalStatus: String = "PENDING",
    val date: String, // yyyy-MM-dd
    val mileage: Int? = null,
    val endMileage: Int? = null,
    val licensePlate: String? = null,
    val notes: String = "",
    @SerializedName("created_at") val createdAt: Long = System.currentTimeMillis(),
    @SerializedName("updated_at") val updatedAt: Long = System.currentTimeMillis(),
    @SerializedName("deleted_at") val deletedAt: Long? = null,
    @SerializedName("sync_state") val syncState: String = "PENDING",
    val revision: Int = 1
)
