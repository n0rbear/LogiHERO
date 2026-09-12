# Proof of Delivery / digital delivery acceptance

Status: planned core LogiHERO capability. This document records the architecture boundary and future requirements; it does not describe an implemented feature.

## Purpose and non-equivalence

At pickup or delivery, a recipient must be able to review the handover on the driver's phone, identify themselves, and sign the exact business state being accepted. The driver confirms separately. The backend then preserves an immutable proof of what was presented and signed.

`cargo.status = DELIVERED` and `POD status = SIGNED` are related but not equivalent:

- cargo delivery is an operational lifecycle transition;
- POD is evidence of acceptance by identified actors over a specific snapshot;
- neither state may be silently inferred from the other;
- refusal or absence must never become automatic acceptance.

## Current source inventory

### A. Implemented and reusable

- Authenticated device identity supplies server-derived driver UUID, driver name, company UUID, and device ID. Existing owner checks scope tours, stops, cargo, and mobile routes.
- Tours, stops, and cargo already provide stable identities and relationships. Cargo includes description, quantity, unit, serial/external/customer references, pickup/delivery stops, notes, and pickup/delivery condition.
- The cargo lifecycle has server-authoritative driver transitions, blocking rules, and dedicated pickup, delivery, damage, and missing-item actions.
- `cargo_events` supplies actor, status transition, stop, time, reason, client event ID, and JSON metadata for cargo lifecycle audit events.
- `live_updates` and tour location routes can provide optional location evidence, including coordinates and timestamps.
- `/version` exposes application version and commit metadata that can be captured in a signed snapshot.
- Forward-only PostgreSQL migrations, admin authentication, and server-rendered admin patterns are available for future schema and inspection work.
- NDP can record low-sensitivity operational events and correlation IDs.

### B. Partially suitable, but not POD

- `cargo_events` is per-cargo mutable-lifecycle history. It is not a multi-item acceptance, does not identify both signers, and does not freeze the complete signed state.
- Cargo condition, notes, serials, and quantities are useful snapshot inputs, but their current rows remain editable and cannot be the evidence referenced by a signature.
- Live location is useful supporting evidence only. A future POD must capture its source, timestamp, accuracy, and staleness rather than treating the latest row as proof without qualification.
- Existing stop completion and cargo blocking can participate in a future POD transaction, but they do not require or prove recipient acceptance today.
- Android recognizes `POD` as a generic document category. That is not backend POD, recipient acceptance, or signature support.
- Current NDP events are diagnostic telemetry, not a durable legal/business audit store.

### C. Missing

- POD/acceptance tables and append-only acceptance audit events;
- recipient and driver signer records;
- signature capture/storage and signature evidence hashes;
- immutable signed snapshot, canonicalization version, content version, and cryptographic content hash;
- POD state machine, refusal/absence/failure workflow, supersession, and voiding controls;
- owner-scoped create/finalize and retrieval APIs;
- lifecycle integration that distinguishes delivery from acceptance;
- admin inspection, printable/downloadable proof, retention, access, and deletion policy.

Repository searches found no backend POD, proof-of-delivery, signature, signed-acceptance, handover, or delivery-receipt schema/routes. Do not claim signature support until those pieces are implemented and tested.

## Planned handover flow

1. The authenticated driver arrives at the pickup or delivery stop.
2. LogiHERO loads the server-authoritative tour, stop, and eligible cargo.
3. The driver records actual quantities, serial/reference numbers, condition, discrepancies, damage, and notes.
4. A dedicated handover screen presents the company/recipient, stop, cargo items, conditions, exceptions, and notes.
5. The recipient confirms their name and role, reviews the complete snapshot, and signs or records a non-acceptance outcome.
6. The driver separately confirms and signs.
7. The backend re-resolves ownership and relationships, constructs the canonical snapshot, records the evidence, and returns an immutable audit ID.
8. Cargo and stop lifecycle changes occur only according to their own domain rules and the configured POD requirement.

The future Android experience will implement steps 2-6, including clear hand-back boundaries and accessibility, but no Android source, database, routes, or API calls are changed by this planning work.

## Signed snapshot rule

Signatures must cover immutable data, never a pointer to mutable current rows. At finalization the server must persist a canonical snapshot containing at least:

- acceptance UUID, type (pickup or delivery), schema/content version, and audit ID;
- company, tour, and stop identities plus their displayed names/addresses;
- every included cargo identity, description, quantity/unit, serial and reference numbers;
- pickup/delivery condition, discrepancies, damage, exceptions, and notes;
- recipient and driver names, roles, and signature timestamps;
- optional coordinates with source, captured time, accuracy, and staleness;
- server-received and finalized timestamps;
- application version, server version, and commit SHA when available;
- signature evidence digests/references;
- canonicalization algorithm/version and a cryptographic content hash.

Canonicalization must be deterministic and versioned. The server computes the hash from the authoritative canonical representation and stores both the frozen representation and hash. A future printable proof must be generated from that snapshot, not from live tour/cargo rows.

Once `SIGNED`, the snapshot and signer evidence are append-only. Business-data edits never rewrite it. If any covered data changes after signing:

`data changed after signature -> new acceptance/signature required`

A replacement is a new acceptance version linked to the prior record. The prior proof remains available and is marked `SUPERSEDED` or `VOIDED` through an auditable event, never overwritten.

## State and exception model

Minimum states:

- `PENDING`: draft/review in progress; not proof of acceptance.
- `SIGNED`: required signers completed an immutable acceptance.
- `REFUSED`: recipient explicitly declined; never treated as signed.
- `RECIPIENT_ABSENT`: no recipient was available.
- `TECHNICAL_FAILURE`: signing could not be completed.
- `VOIDED`: invalidated by an authorized actor with a reason, while evidence remains.
- `SUPERSEDED`: replaced by a newer acceptance version.

Exceptional completion requires reason code, explanatory note, timestamp, authenticated actor, and append-only audit event. Authorization policy must define who may void or supersede signed evidence. A refusal, absent recipient, or technical failure must not automatically complete cargo or a stop.

## Likely backend model

Final naming is an implementation decision, but the model should separate these concerns:

### Acceptance header and snapshot

A `delivery_acceptances`-style table should hold UUID, company/tour/stop ownership keys, pickup/delivery type, state, version, predecessor/superseder linkage, authoritative snapshot JSON, canonicalization version, content hash, server/app versions, creator driver/device, creation/finalization timestamps, optional qualified location evidence, and exception fields.

Database constraints should prevent duplicate active acceptance versions for the same business event and prevent update/delete of signed snapshot fields. Finalization should lock and re-read the relevant tour, stop, and cargo rows in one transaction before hashing.

### Signers and signature storage

A child signer table should hold acceptance UUID, signer role (`RECIPIENT` or `DRIVER`), confirmed display name, signed timestamp, signature evidence reference/digest, and capture metadata. Both roles are distinct; one signature must not be copied into the other role.

Raw signature strokes or images are sensitive personal data. Prefer immutable encrypted object storage with an opaque object key, media type, byte length, and SHA-256 digest in PostgreSQL. A database binary strategy is possible for small installations, but must still have encryption, size limits, access control, backup/restore, retention, and deletion rules. Raw signature material must not appear in URLs, ordinary logs, analytics, or NDP.

### Snapshot items and audit

The signed JSON snapshot is the evidence authority. Optional immutable item rows may support indexing/reporting but must carry the same acceptance version and cannot replace the snapshot/hash. An append-only `delivery_acceptance_events`-style table should record creation, signer completion, finalization, refusal, absence, technical failure, voiding, and supersession with actor, time, reason, request/client event ID, and acceptance ID.

## API and UI surface to design later

- owner-scoped endpoint to load an authoritative handover candidate;
- create/resume draft endpoint with idempotency key;
- recipient-sign and driver-sign operations, or a carefully designed atomic finalization operation;
- explicit refusal, absent-recipient, and technical-failure operations;
- immutable retrieval endpoint for an acceptance version;
- admin list/detail inspection with restricted signature access;
- printable/downloadable proof generated from the signed snapshot;
- authorized void/supersede workflow.

The API must define retry/idempotency, offline behavior, partial signature recovery, maximum payload sizes, timeouts, and whether lifecycle transitions and POD finalization are atomic. Generic `/api/sync` must not become a bypass around the dedicated POD state machine.

## Security and data integrity

- A driver may create or finalize POD only for their authenticated, owned tour and stop.
- The server resolves company, tour, stop, cargo membership, and eligible state. Caller-controlled foreign IDs cannot attach signatures to another driver or company.
- Cargo included in the snapshot must belong to the authorized tour and relevant stop. The server rejects omitted/extra/reassigned items contrary to the chosen handover contract.
- Finalization uses server time and records client capture time separately. Client GPS is evidence with provenance, not unquestioned authority.
- Signed snapshots and signature evidence are immutable. Later edits require a new version and signatures.
- Retrieval and printable proof require explicit driver-owner or admin authorization and should be auditable.
- Signature data and unnecessary recipient personal data must not be logged to NDP. NDP may receive IDs, state, result/error code, and timing only.
- Logs must not contain signature images/strokes, raw snapshot bodies, names when unnecessary, or unredacted personal notes.
- Retention, privacy notice/consent, export, access, legal hold, and deletion/anonymization rules require product/legal decisions before implementation.

## Lifecycle integration

POD requirements may differ for pickup and delivery and should be explicit configuration/domain policy. The backend should evaluate acceptance state alongside current cargo, hotel, and stop blocking rules. It must remain possible to represent truthfully that cargo was operationally delivered while acceptance was refused or unavailable.

No implementation should update cargo/stop state merely because a signature payload was submitted. The server must first validate ownership, relationships, snapshot contents, signer requirements, idempotency, and state transition. Overrides require explicit authority, reason, note, timestamp, and audit.

## Implementation checkpoints for a future task

1. Resolve product/legal decisions: required signer roles, pickup vs delivery requirements, offline semantics, retention, consent, signature format, and exceptional completion authority.
2. Threat-model replay, foreign-ID attachment, mutable-snapshot, substitution, partial-upload, duplicate-finalization, clock/GPS spoofing, and signature-data disclosure.
3. Add forward-only migrations and schema-contract coverage.
4. Implement owner-scoped backend domain service and dedicated APIs with real PostgreSQL tests.
5. Add admin inspection and snapshot-based printable proof.
6. Design and implement Android handover UI only under a separately authorized Android task.
7. Validate end-to-end, backup/restore, privacy, and production rollout before enabling POD as a completion requirement.
