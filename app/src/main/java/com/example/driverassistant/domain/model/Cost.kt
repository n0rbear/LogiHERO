package com.example.driverassistant.domain.model

import androidx.room.Entity
import androidx.room.PrimaryKey
import com.google.gson.annotations.SerializedName

@Entity(tableName = "costs")
data class Cost(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val uuid: String = java.util.UUID.randomUUID().toString(),
    val driverName: String = "Ismeretlen",
    val amount: Double,
    val currency: String,
    val category: String, // Hotel, Parkolás, Matrica, Útdíj, Tankolás, Egyéb
    val notes: String = "",
    val photoPath: String? = null,
    val status: String = "Rögzítve", // Rögzítve, Beküldve, Elfogadva, Kifizetve
    val timestamp: Long,
    val mileage: Int? = null,
    @SerializedName("created_at") val createdAt: Long = System.currentTimeMillis(),
    @SerializedName("updated_at") val updatedAt: Long = System.currentTimeMillis(),
    @SerializedName("deleted_at") val deletedAt: Long? = null,
    @SerializedName("sync_state") val syncState: String = "SYNCED",
    val revision: Int = 1
)
