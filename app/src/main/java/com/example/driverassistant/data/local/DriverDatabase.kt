package com.example.driverassistant.data.local

import androidx.room.Database
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import com.example.driverassistant.data.local.dao.DriverDao
import com.example.driverassistant.domain.model.*

@Database(
    entities = [
        Tour::class,
        Stop::class,
        Document::class,
        Cost::class,
        Hotel::class,
        HotelEvent::class,
        LocationData::class,
        WorkTime::class,
        SavedLocation::class,
        CustomerMapping::class,
        ChatMessage::class,
        Cargo::class,
        CargoEvent::class
    ],
    version = 28,
    exportSchema = false
)
abstract class DriverDatabase : RoomDatabase() {
    abstract val dao: DriverDao

    companion object {
        val MIGRATION_27_28 = object : Migration(27, 28) {
            override fun migrate(db: SupportSQLiteDatabase) {
                val withFullSyncMeta = listOf("tours", "stops", "hotels", "cargo", "work_times", "costs")
                for (table in withFullSyncMeta) {
                    try { db.execSQL("ALTER TABLE $table ADD COLUMN syncState TEXT NOT NULL DEFAULT 'SYNCED'") } catch (_: Exception) {}
                    try { db.execSQL("ALTER TABLE $table ADD COLUMN revision INTEGER NOT NULL DEFAULT 1") } catch (_: Exception) {}
                }
                for (table in listOf("tours", "stops")) {
                    try { db.execSQL("ALTER TABLE $table ADD COLUMN createdAt INTEGER NOT NULL DEFAULT 0") } catch (_: Exception) {}
                    db.execSQL("UPDATE $table SET createdAt = COALESCE(updatedAt, 0) WHERE createdAt = 0")
                }
                for (table in listOf("work_times", "costs")) {
                    try { db.execSQL("ALTER TABLE $table ADD COLUMN createdAt INTEGER NOT NULL DEFAULT 0") } catch (_: Exception) {}
                    try { db.execSQL("ALTER TABLE $table ADD COLUMN updatedAt INTEGER NOT NULL DEFAULT 0") } catch (_: Exception) {}
                    try { db.execSQL("ALTER TABLE $table ADD COLUMN deletedAt INTEGER") } catch (_: Exception) {}
                }
                db.execSQL("UPDATE work_times SET createdAt = CASE WHEN createdAt = 0 THEN COALESCE(startTime, 0) ELSE createdAt END")
                db.execSQL("UPDATE costs SET createdAt = CASE WHEN createdAt = 0 THEN COALESCE(timestamp, 0) ELSE createdAt END")
                db.execSQL("UPDATE work_times SET updatedAt = CASE WHEN updatedAt = 0 THEN createdAt ELSE updatedAt END")
                db.execSQL("UPDATE costs SET updatedAt = CASE WHEN updatedAt = 0 THEN createdAt ELSE updatedAt END")
            }
        }

        val MIGRATION_26_27 = object : Migration(26, 27) {
            override fun migrate(db: SupportSQLiteDatabase) {
                // 1. Expand Hotels table
                db.execSQL("ALTER TABLE hotels ADD COLUMN public_id TEXT NOT NULL DEFAULT ''")
                db.execSQL("ALTER TABLE hotels ADD COLUMN tour_id INTEGER")
                db.execSQL("ALTER TABLE hotels ADD COLUMN stop_id INTEGER")
                db.execSQL("ALTER TABLE hotels ADD COLUMN driver_id INTEGER")
                db.execSQL("ALTER TABLE hotels ADD COLUMN address_line_1 TEXT NOT NULL DEFAULT ''")
                db.execSQL("ALTER TABLE hotels ADD COLUMN address_line_2 TEXT")
                db.execSQL("ALTER TABLE hotels ADD COLUMN postal_code TEXT")
                db.execSQL("ALTER TABLE hotels ADD COLUMN city TEXT NOT NULL DEFAULT ''")
                db.execSQL("ALTER TABLE hotels ADD COLUMN country TEXT")
                db.execSQL("ALTER TABLE hotels ADD COLUMN latitude REAL")
                db.execSQL("ALTER TABLE hotels ADD COLUMN longitude REAL")
                db.execSQL("ALTER TABLE hotels ADD COLUMN phone TEXT")
                db.execSQL("ALTER TABLE hotels ADD COLUMN booking_provider TEXT")
                db.execSQL("ALTER TABLE hotels ADD COLUMN check_in_date TEXT")
                db.execSQL("ALTER TABLE hotels ADD COLUMN check_in_time TEXT")
                db.execSQL("ALTER TABLE hotels ADD COLUMN check_out_date TEXT")
                db.execSQL("ALTER TABLE hotels ADD COLUMN check_out_time TEXT")
                db.execSQL("ALTER TABLE hotels ADD COLUMN number_of_nights INTEGER")
                db.execSQL("ALTER TABLE hotels ADD COLUMN number_of_rooms INTEGER")
                db.execSQL("ALTER TABLE hotels ADD COLUMN status TEXT NOT NULL DEFAULT 'PLANNED'")
                db.execSQL("ALTER TABLE hotels ADD COLUMN street_view_url TEXT")
                db.execSQL("ALTER TABLE hotels ADD COLUMN external_map_url TEXT")
                db.execSQL("ALTER TABLE hotels ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0")
                db.execSQL("ALTER TABLE hotels ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0")
                db.execSQL("ALTER TABLE hotels ADD COLUMN deleted_at INTEGER")
                db.execSQL("ALTER TABLE hotels ADD COLUMN contact_name TEXT")
                db.execSQL("ALTER TABLE hotels ADD COLUMN reservation_name TEXT")
                db.execSQL("ALTER TABLE hotels ADD COLUMN breakfast_included INTEGER NOT NULL DEFAULT 0")
                db.execSQL("ALTER TABLE hotels ADD COLUMN parking_included INTEGER NOT NULL DEFAULT 0")
                db.execSQL("ALTER TABLE hotels ADD COLUMN late_check_in INTEGER NOT NULL DEFAULT 0")
                db.execSQL("ALTER TABLE hotels ADD COLUMN room_type TEXT")
                db.execSQL("ALTER TABLE hotels ADD COLUMN roomNumber TEXT")
                db.execSQL("ALTER TABLE hotels ADD COLUMN entryCode TEXT")

                // Migrate existing data if possible
                db.execSQL("UPDATE hotels SET public_id = uuid, address_line_1 = address, created_at = timestamp, updated_at = timestamp")
                db.execSQL("UPDATE hotels SET roomNumber = room_number, entryCode = entry_code")

                // 2. Create Hotel Events table
                db.execSQL("""
                    CREATE TABLE IF NOT EXISTS `hotel_events` (
                        `id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, 
                        `hotel_id` INTEGER NOT NULL, 
                        `event_type` TEXT NOT NULL, 
                        `from_status` TEXT, 
                        `to_status` TEXT, 
                        `actor_type` TEXT NOT NULL, 
                        `actor_id` TEXT NOT NULL, 
                        `timestamp` INTEGER NOT NULL, 
                        `reason` TEXT, 
                        `client_event_id` TEXT NOT NULL, 
                        `metadata` TEXT, 
                        `is_synced` INTEGER NOT NULL DEFAULT 0
                    )
                """.trimIndent())
                db.execSQL("CREATE UNIQUE INDEX IF NOT EXISTS `index_hotel_events_client_event_id` ON `hotel_events` (`client_event_id`)")
            }
        }

        val MIGRATION_25_26 = object : Migration(25, 26) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("""
                    CREATE TABLE IF NOT EXISTS `cargo` (
                        `id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, 
                        `uuid` TEXT NOT NULL, 
                        `tourId` INTEGER NOT NULL, 
                        `pickupStopId` INTEGER, 
                        `deliveryStopId` INTEGER, 
                        `pickupStopUuid` TEXT, 
                        `deliveryStopUuid` TEXT,
                        `type` TEXT NOT NULL DEFAULT 'MACHINE', 
                        `name` TEXT NOT NULL, 
                        `description` TEXT, 
                        `quantity` INTEGER NOT NULL DEFAULT 1, 
                        `unit` TEXT NOT NULL DEFAULT 'pcs', 
                        `serialNumber` TEXT, 
                        `externalReference` TEXT, 
                        `customerReference` TEXT, 
                        `weightKg` REAL, 
                        `lengthCm` REAL, 
                        `widthCm` REAL, 
                        `heightCm` REAL, 
                        `status` TEXT NOT NULL DEFAULT 'PLANNED', 
                        `conditionAtPickup` TEXT, 
                        `conditionAtDelivery` TEXT, 
                        `notes` TEXT, 
                        `driverName` TEXT, 
                        `createdAt` INTEGER NOT NULL, 
                        `updatedAt` INTEGER NOT NULL, 
                        `deletedAt` INTEGER, 
                        FOREIGN KEY(`tourId`) REFERENCES `tours`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE 
                    )
                """.trimIndent())
                db.execSQL("CREATE UNIQUE INDEX IF NOT EXISTS `index_cargo_uuid` ON `cargo` (`uuid`)")
                db.execSQL("CREATE INDEX IF NOT EXISTS `index_cargo_tourId` ON `cargo` (`tourId`)")

                db.execSQL("""
                    CREATE TABLE IF NOT EXISTS `cargo_events` (
                        `id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, 
                        `cargoId` INTEGER NOT NULL, 
                        `eventType` TEXT NOT NULL, 
                        `fromStatus` TEXT, 
                        `toStatus` TEXT, 
                        `actorType` TEXT, 
                        `actorId` TEXT, 
                        `stopId` INTEGER, 
                        `timestamp` INTEGER NOT NULL, 
                        `reason` TEXT, 
                        `clientEventId` TEXT, 
                        `metadata` TEXT, 
                        FOREIGN KEY(`cargoId`) REFERENCES `cargo`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE 
                    )
                """.trimIndent())
                db.execSQL("CREATE UNIQUE INDEX IF NOT EXISTS `index_cargo_events_clientEventId` ON `cargo_events` (`clientEventId`)")
                db.execSQL("CREATE INDEX IF NOT EXISTS `index_cargo_events_cargoId` ON `cargo_events` (`cargoId`)")
            }
        }

        val MIGRATION_13_14 = object : Migration(13, 14) {
            override fun migrate(db: SupportSQLiteDatabase) {
                val tables = listOf(
                    "tours", "stops", "documents", "costs", "hotels",
                    "location_history", "work_times", "saved_locations",
                    "customer_mappings", "chat_messages"
                )
                for (table in tables) {
                    db.execSQL("ALTER TABLE $table ADD COLUMN uuid TEXT NOT NULL DEFAULT ''")
                    db.execSQL("""
                        UPDATE $table SET uuid = 
                        lower(hex(randomblob(4))) || '-' || 
                        lower(hex(randomblob(2))) || '-' || 
                        '4' || substr(lower(hex(randomblob(2))), 2, 3) || '-' || 
                        substr('89ab', (abs(random()) % 4) + 1, 1) || substr(lower(hex(randomblob(2))), 2, 3) || '-' || 
                        lower(hex(randomblob(6)))
                    """.trimIndent())
                }
            }
        }

        val MIGRATION_14_15 = object : Migration(14, 15) {
            override fun migrate(db: SupportSQLiteDatabase) {
                val tables = listOf(
                    "tours", "stops", "documents", "costs", "hotels",
                    "location_history", "work_times", "saved_locations",
                    "customer_mappings", "chat_messages"
                )
                for (table in tables) {
                    db.execSQL("""
                        UPDATE $table SET uuid = 
                        lower(hex(randomblob(4))) || '-' || 
                        lower(hex(randomblob(2))) || '-' || 
                        '4' || substr(lower(hex(randomblob(2))), 2, 3) || '-' || 
                        substr('89ab', (abs(random()) % 4) + 1, 1) || substr(lower(hex(randomblob(2))), 2, 3) || '-' || 
                        lower(hex(randomblob(6)))
                        WHERE uuid NOT LIKE '%-%' OR length(uuid) != 36
                    """.trimIndent())
                }
            }
        }

        val MIGRATION_15_16 = object : Migration(15, 16) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE tours ADD COLUMN deletedAt INTEGER")
                db.execSQL("ALTER TABLE stops ADD COLUMN deletedAt INTEGER")
            }
        }

        val MIGRATION_16_17 = object : Migration(16, 17) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE stops ADD COLUMN recipient TEXT NOT NULL DEFAULT ''")
                db.execSQL("ALTER TABLE stops ADD COLUMN street TEXT NOT NULL DEFAULT ''")
                db.execSQL("ALTER TABLE stops ADD COLUMN houseNumber TEXT NOT NULL DEFAULT ''")
                db.execSQL("ALTER TABLE stops ADD COLUMN postalCode TEXT NOT NULL DEFAULT ''")
                db.execSQL("ALTER TABLE stops ADD COLUMN city TEXT NOT NULL DEFAULT ''")
                db.execSQL("ALTER TABLE stops ADD COLUMN addressFull TEXT NOT NULL DEFAULT ''")
                db.execSQL("ALTER TABLE tours ADD COLUMN updatedAt INTEGER")
                db.execSQL("ALTER TABLE stops ADD COLUMN updatedAt INTEGER")
            }
        }

        val MIGRATION_17_18 = object : Migration(17, 18) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE tours ADD COLUMN depotName TEXT NOT NULL DEFAULT ''")
                db.execSQL("ALTER TABLE tours ADD COLUMN depotLatitude REAL")
                db.execSQL("ALTER TABLE tours ADD COLUMN depotLongitude REAL")
            }
        }

        val MIGRATION_18_19 = object : Migration(18, 19) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE stops ADD COLUMN stopType TEXT NOT NULL DEFAULT 'DELIVERY'")
            }
        }

        val MIGRATION_19_20 = object : Migration(19, 20) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE documents ADD COLUMN driverName TEXT NOT NULL DEFAULT 'Ismeretlen'")
                db.execSQL("ALTER TABLE chat_messages ADD COLUMN driverName TEXT NOT NULL DEFAULT 'Ismeretlen'")
            }
        }

        val MIGRATION_20_21 = object : Migration(20, 21) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE stops ADD COLUMN photoUrl TEXT")
            }
        }

        val MIGRATION_21_22 = object : Migration(21, 22) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE hotels ADD COLUMN bookingNumber TEXT NOT NULL DEFAULT ''")
            }
        }

        val MIGRATION_22_23 = object : Migration(22, 23) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE stops ADD COLUMN stopDate INTEGER")
            }
        }

        val MIGRATION_23_24 = object : Migration(23, 24) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE stops ADD COLUMN roomNumber TEXT NOT NULL DEFAULT ''")
                db.execSQL("ALTER TABLE stops ADD COLUMN entryCode TEXT NOT NULL DEFAULT ''")
                db.execSQL("ALTER TABLE stops ADD COLUMN bookingNumber TEXT NOT NULL DEFAULT ''")
            }
        }

        val MIGRATION_24_25 = object : Migration(24, 25) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE tours ADD COLUMN vehicle TEXT NOT NULL DEFAULT ''")
                db.execSQL("ALTER TABLE tours ADD COLUMN trailer TEXT NOT NULL DEFAULT ''")
                db.execSQL("ALTER TABLE tours ADD COLUMN returnDepotName TEXT NOT NULL DEFAULT ''")
                db.execSQL("ALTER TABLE tours ADD COLUMN returnDepotAddressFull TEXT NOT NULL DEFAULT ''")
                db.execSQL("ALTER TABLE tours ADD COLUMN returnDepotLat REAL")
                db.execSQL("ALTER TABLE tours ADD COLUMN returnDepotLng REAL")
                db.execSQL("ALTER TABLE tours ADD COLUMN plannedStartAt INTEGER")
                db.execSQL("ALTER TABLE tours ADD COLUMN plannedEndAt INTEGER")
                db.execSQL("ALTER TABLE tours ADD COLUMN actualStartAt INTEGER")
                db.execSQL("ALTER TABLE tours ADD COLUMN actualEndAt INTEGER")
                db.execSQL("ALTER TABLE tours ADD COLUMN tourStatus TEXT NOT NULL DEFAULT 'PLANNED'")
                db.execSQL("ALTER TABLE tours ADD COLUMN nextStopId INTEGER")
                db.execSQL("ALTER TABLE tours ADD COLUMN plannedDistanceKm REAL")
                db.execSQL("ALTER TABLE tours ADD COLUMN plannedDurationSeconds INTEGER")
                db.execSQL("ALTER TABLE tours ADD COLUMN remainingDistanceKm REAL")
                db.execSQL("ALTER TABLE tours ADD COLUMN remainingDurationSeconds INTEGER")
                db.execSQL("ALTER TABLE tours ADD COLUMN completedDistanceKm REAL")
                db.execSQL("ALTER TABLE tours ADD COLUMN routeStatus TEXT NOT NULL DEFAULT 'NOT_CALCULATED'")
                db.execSQL("ALTER TABLE stops ADD COLUMN stopStatus TEXT NOT NULL DEFAULT 'PENDING'")
                db.execSQL("ALTER TABLE stops ADD COLUMN actualDepartureTime INTEGER")
                db.execSQL("ALTER TABLE stops ADD COLUMN segmentDistanceKm REAL")
                db.execSQL("ALTER TABLE stops ADD COLUMN segmentDurationSeconds INTEGER")
                db.execSQL("ALTER TABLE stops ADD COLUMN cumulativeDistanceKm REAL")
                db.execSQL("ALTER TABLE stops ADD COLUMN cumulativeDurationSeconds INTEGER")
                db.execSQL("ALTER TABLE stops ADD COLUMN routeWarning TEXT")
            }
        }
    }
}
