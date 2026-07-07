# PassDeck Data Compatibility Contract

This document defines the current PassDeck-owned data contract inside KDBX files.

The current stage is contract formalization only. It does not introduce a migration and does not change the KDBX file format.

## Goals

- Keep PassDeck-created databases compatible with KeePass/KeePassXC.
- Make PassDeck metadata explicit and testable.
- Avoid accidental KDBX customData drift.
- Separate KDBX compatibility from PassDeck UI/session state.

## KDBX Format

PassDeck writes standard KDBX 4.1 databases with AES-256 and Argon2id.

PassDeck may open compatible KDBX 3/4 databases, but new databases are created as KDBX 4.1.

## Standard Entry Fields

PassDeck treats these KDBX fields as reserved:

- `Title`
- `UserName`
- `Password`
- `URL`
- `Notes`

User custom fields must not use the reserved names above, case-insensitively.

## PassDeck-Owned customData Keys

The only PassDeck-owned entry `customData` keys currently allowed are:

- `PassDeck.Favorite`
- `PassDeck.AutoTypeEnabled`
- `PassDeck.AutoTypeSequence`

The source of truth in code is `PASSDECK_CUSTOM_DATA_KEYS` in `apps/desktop/src/main/services/passdeck-metadata.ts`.

Adding a new `PassDeck.*` key requires:

- updating this document;
- updating `PASSDECK_CUSTOM_DATA_KEYS`;
- adding or updating tests;
- confirming KeePass/KeePassXC compatibility;
- documenting whether the key is optional, defaulted, or migratable.

## Defaults

`PassDeck.Favorite` defaults to `false` when absent.

`PassDeck.AutoTypeEnabled` defaults to enabled unless explicitly set to `false`.

`PassDeck.AutoTypeSequence` defaults to:

```text
{USERNAME}{TAB}{PASSWORD}{ENTER}
```

Renderer save requests do not own Auto-Type settings. The main process writes the fixed defaults.

## PassDeck State Not Stored In KDBX

The following are application/session state and must not be stored inside the KDBX file:

- open tab order;
- selected entry/group;
- recent databases;
- window bounds;
- theme and UI scale;
- Touch ID availability/status;
- lock ownership;
- read-only state;
- recovery scheduler state.

These belong in settings or runtime-only main-process state.

## Compatibility Suite Target

The minimum compatibility suite before `1.0` should cover:

- create a PassDeck database, open it in KeePassXC, then reopen it in PassDeck;
- open an external KeePass/KeePassXC KDBX in PassDeck, save it, then reopen it externally;
- verify protected custom fields remain protected;
- verify attachments remain readable externally;
- verify PassDeck customData is ignored by external clients and preserved by PassDeck.

## Non-Goals

- No history UI.
- No recycle-bin UI.
- No `Save As`.
- No recovery key or password reset.
- No KDBX migration in this stage.
