# PassDeck 1.0 Release Gates

This document defines the release gates required before calling PassDeck stable `1.0.0`.

## Automated Gate

Run:

```powershell
npm run verify:release-gates
```

The automated gate runs:

- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run build`
- `npm run benchmark:kdbx`

## Compatibility Gate

Manual compatibility coverage before `1.0.0`:

- create a PassDeck database and open it in KeePassXC;
- open a KeePassXC-created KDBX in PassDeck;
- save in PassDeck and reopen in KeePassXC;
- verify protected custom fields remain protected;
- verify attachments remain readable externally;
- verify PassDeck-owned `customData` keys are preserved by PassDeck and ignored by external clients.

Record tested app versions and operating systems in release notes.

## Performance Gate

Required baseline:

- demo database `open/save` benchmark;
- synthetic medium database benchmark;
- synthetic large database benchmark;
- no main-window freeze during normal user flows.

The current scripted baseline starts with:

```powershell
npm run benchmark:kdbx
```

Future large fixtures should be generated or provided separately and passed to the benchmark script:

```powershell
npm run benchmark:kdbx -- path\to\Large.kdbx "MasterPassword"
```

## Security Gate

Before `1.0.0`:

- review IPC surface and confirm there is no generic invoke;
- review secret flows for master password, entry password, protected fields, attachments, Touch ID, recovery;
- confirm secrets are not written to settings, logs, URLs, DOM attributes, or test snapshots;
- review file IO: lock files, atomic save, backups, recovery, attachments;
- review dependency overrides and run the package manager audit separately when network access is available.

## Documentation Gate

Before `1.0.0`:

- update README for end-user workflows;
- update architecture and security docs;
- add recovery behavior documentation once renderer UX is exposed;
- document Windows and macOS permission requirements;
- document demo database password and scope.

## Build Gate

Before `1.0.0`:

- produce stable Windows portable build;
- produce stable macOS build;
- smoke-test launch, create/open/save/lock/unlock, Auto-Type shortcut registration, Touch ID fallback, attachments, recovery cleanup.

## Release Decision

`1.0.0` can be cut only when:

- automated gate passes;
- compatibility gate evidence is recorded;
- performance baseline is recorded;
- security review findings are either fixed or explicitly accepted;
- Windows and macOS builds are smoke-tested.
