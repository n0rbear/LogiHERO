# Android Build Modernization

Sprint J did not require Android source changes. The Android validation was still run because the release gate depends on backend/mobile compatibility.

## Current result

- JVM tests: passed.
- Connected Android tests: passed on `NDP_E2E_API_36`, `emulator-5554`, Android 16.
- Flavors covered by connected tests: full debug and pilot debug.

## Warning audit

`gradlew help --warning-mode all` reports AGP 10 preparation warnings:

- Deprecated Android project options in `gradle.properties`.
- Legacy variant APIs: `applicationVariants`, `testVariants`, `unitTestVariants`.
- `android.enableJetifier=true` deprecation.
- Library constraint performance warning.

These are modernization items, not Sprint J blockers, because build, JVM tests and connected tests pass. Sprint K should remove or replace these deprecated settings before the AGP 10 upgrade window.
