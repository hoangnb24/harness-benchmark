# Exec Plan

## Goal

Add read-only folder sharing between authenticated users without weakening existing owner-only write behavior.

## Scope

In scope:

- Folder share and revoke endpoints.
- Shared-folder listing endpoint.
- Read access to shared folders and their bookmarks.
- Explicit write denial for shared users.
- Product docs, durable decision, story proof, and tests.

Out of scope:

- Anonymous sharing.
- Writable sharing.
- Sharing tags as first-class collaborative resources.
- Importing directly into another user's folder.

## Risk Classification

Risk flags:

- Authorization.
- Data model.
- Public contracts.
- Existing behavior.
- Weak proof.

Hard gates:

- Authorization.

## Work Phases

1. Discovery.
2. Design.
3. Validation planning.
4. Implementation.
5. Verification.
6. Harness update.

## Stop Conditions

Pause for human confirmation if:

- Shared users need write permissions.
- Shared bookmarks must appear in the owner's existing list/search endpoints.
- Data migration needs to transform existing ownership.
- Validation requirements need to be weakened.
