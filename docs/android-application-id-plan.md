# LogiHERO Android application ID and package migration plan

Date: 2026-07-25

## Current State

The Android application still uses:

- namespace/application ID: `com.example.driverassistant`
- Kotlin package path: `com/example/driverassistant`
- main class name: `DriverAssistantApp`
- theme name: `Theme.DriverAssistant`

This was intentionally not migrated in this round.

## Why It Was Not Changed Automatically

Changing the application ID creates a separate installed Android app. Existing installed data, notifications, app links, update paths, and local Room database ownership can be affected. Kotlin package migration is also a broad mechanical change with high conflict risk.

## Recommended Decision

For internal testing:

- Keep `com.example.driverassistant` until the release/install strategy is decided.

For public LogiHERO release:

- Migrate application ID to a stable production ID, for example `hu.logihero.driver` or `com.logihero.driver`.
- Migrate Kotlin package names in a separate focused branch.

## Migration Steps

1. Decide final application ID.
2. Decide whether existing tester devices need data migration or a clean install.
3. Rename namespace/application ID in Gradle.
4. Rename Kotlin packages and source folders.
5. Rename app class and theme identifiers.
6. Verify Room database continuity or intentionally reset local app data.
7. Rebuild debug and release variants.
8. Test install, upgrade, sync, notifications, file uploads, and NDP events.

## Rollback Plan

Keep the current app ID branch until the migrated app has passed install and sync tests on at least one clean device and one device with existing data.
