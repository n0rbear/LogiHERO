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
        LocationData::class,
        WorkTime::class,
        SavedLocation::class,
        CustomerMapping::class,
        ChatMessage::class,
        Cargo::class,
        CargoEvent::class
    ],
    version = 26,
    exportSchema = false
)
abstract class DriverDatabase : RoomDatabase() {
    abstract val dao: DriverDao

    companion object {
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
                        `metadata` TEXT, 
                        FOREIGN KEY(`cargoId`) REFERENCES `cargo`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE 
                    )
                """.trimIndent())
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
                    // Fill existing rows with RFC-4122 v4 compliant UUID strings
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
                    // Fix any non-compliant UUIDs (e.g. from previous pseudo-UUID generation)
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
