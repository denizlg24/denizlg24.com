# Envoy Cryptographic Implementation Security Analysis

This document provides a comprehensive security analysis of Envoy's cryptographic implementation, focusing on the commit history system and change detection mechanism.

## Table of Contents

1. [Overview](#overview)
2. [Cryptographic Primitives](#cryptographic-primitives)
3. [Key Derivation](#key-derivation)
4. [Encryption Scheme](#encryption-scheme)
5. [Content Addressing](#content-addressing)
6. [Change Detection Security](#change-detection-security)
7. [Managed File Encryption and Access](#managed-file-encryption-and-access)
8. [Threat Model](#threat-model)
9. [Security Properties](#security-properties)
10. [Potential Weaknesses](#potential-weaknesses)
11. [Recommendations](#recommendations)

---

## Overview

Envoy is a client-side encrypted secret management tool that implements a Git-like version control system. The fundamental security principle is **zero-knowledge**: the server never has access to plaintext data or encryption keys.

### Core Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        CLIENT                               │
│  ┌─────────────┐    ┌──────────────┐    ┌────────────────┐  │
│  │  Plaintext  │──▶     Encrypt     ──▶|  Ciphertext    |  │
│  │  (Secrets)  │    │  XChaCha20-  │    │  (Blob Hash)   │  │
│  │             │    │   Poly1305   │    │                │  │
│  └─────────────┘    └──────────────┘    └────────────────┘  │
│         │                                       │           │
│         ▼                                       ▼           │
│  ┌─────────────┐                        ┌────────────────┐  │
│  │  Content    │                        │    Server      │  │
│  │  Hash       │                        │   (Untrusted)  │  │
│  │ (SHA-256)   │                        │                │  │
│  └─────────────┘                        └────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## Cryptographic Primitives

### Algorithms Used

| Purpose | Algorithm | Security Level |
|---------|-----------|----------------|
| Symmetric Encryption | XChaCha20-Poly1305 | 256-bit |
| Project Key Derivation | Argon2id | Memory-hard |
| File Key Derivation | HKDF-SHA-256 | 256-bit |
| Content Hashing | SHA-256 | 256-bit |
| Content Addressing | SHA-256 of ciphertext | 256-bit |

### Why These Choices Are Safe

#### XChaCha20-Poly1305

- **Extended nonce (192-bit)**: Eliminates nonce collision concerns for randomly-generated nonces
- **AEAD construction**: Provides both confidentiality and integrity
- **Widely audited**: Used in TLS 1.3, WireGuard, and libsodium
- **Side-channel resistant**: Constant-time implementation in most libraries

#### Argon2id

- **Winner of Password Hashing Competition (2015)**
- **Memory-hard**: Resistant to GPU/ASIC attacks
- **Hybrid design**: Combines Argon2i (side-channel resistance) and Argon2d (GPU resistance)
- **Configurable parameters**: Memory, iterations, and parallelism can be tuned

#### SHA-256

- **Collision resistant**: No known practical collision attacks
- **Pre-image resistant**: Cannot reverse hash to find input
- **Second pre-image resistant**: Cannot find different input with same hash

---

## Key Derivation

### Manifest Key Derivation

```rust
fn derive_manifest_key_from_passphrase(passphrase: &str, project_id: &str) -> Result<Vec<u8>>
```

**Process:**
1. User provides passphrase
2. Project ID serves as **salt** (unique per project)
3. Argon2id derives a 256-bit key

**Security Properties:**

| Property | Implementation | Status |
|----------|----------------|--------|
| Salt uniqueness | Project ID (UUID) | ✅ Safe |
| Memory hardness | Argon2id default params | ✅ Safe |
| Key length | 256 bits | ✅ Safe |

**Why Project ID as Salt is Safe:**

- Each project has a unique UUID
- Same passphrase on different projects yields different keys
- Prevents rainbow table attacks
- Project ID is not secret (stored in `.envoy/config.toml`)

⚠️ **Note**: The salt (project ID) is not secret, but this is acceptable for Argon2id as the salt's purpose is uniqueness, not secrecy.

### Managed File Key Derivation

`envy add` derives a fresh key for every encryption:

```text
file_key = HKDF-SHA-256(project_key, random_128_bit_salt, "envoy-file-key-v1")
```

The salt is stored in the encrypted file header. This keeps the one-passphrase
workflow while separating file encryption keys and ensuring that encrypting the
same file twice produces unrelated ciphertext.

---

## Encryption Scheme

### Data Encryption Flow

```
Managed file plaintext → HKDF file key → XChaCha20-Poly1305 → Ciphertext
                              │                    │
                              │                    └── Random 192-bit nonce
                              └── Random 128-bit salt

Manifest/commit JSON → XChaCha20-Poly1305(project key) → Ciphertext
```

### Nonce Handling

```rust
let nonce = XChaCha20Poly1305::generate_nonce(&mut OsRng);
```

**Security Analysis:**

- **192-bit random nonce** per encryption operation
- Probability of collision after $n$ encryptions: $\frac{n^2}{2^{193}}$
- For $2^{64}$ encryptions: collision probability ≈ $2^{-65}$ (negligible)

**Why Random Nonces Are Safe Here:**

Unlike AES-GCM (96-bit nonce), XChaCha20's 192-bit nonce space allows safe random generation:

| Nonce Size | Safe Random Encryptions |
|------------|------------------------|
| 96-bit (AES-GCM) | ~$2^{32}$ |
| 192-bit (XChaCha20) | ~$2^{64}$ |

---

## Content Addressing

### Two Types of Hashes

Envoy uses two distinct hash types:

#### 1. Blob Hash (Storage Identifier)

```rust
let encrypted = encrypt_file_bytes(&plaintext, &project_key)?;
let blob_hash = SHA256(encrypted);  // Hash of CIPHERTEXT
```

**Purpose**: Content-addressable storage identifier
**Properties**: 
- Changes with each encryption (different nonce → different ciphertext)
- Used for deduplication on server
- Non-deterministic for same plaintext

#### 2. Content Hash (Change Detection)

```rust
let file_content_hash = SHA256(file_plaintext);
let manifest_content_hash = SHA256(JSON(manifest));
```

**Purpose**: Detect logical changes in data
**Properties**:
- Deterministic for same content
- File hashes are stored only inside the encrypted manifest
- Manifest hashes are computed locally for change detection

### Security Implications

| Hash Type | Deterministic | Sent to Server | Purpose |
|-----------|---------------|----------------|---------|
| Blob Hash | ❌ No | ✅ Yes | Storage key |
| Content Hash | ✅ Yes | ❌ No (only encrypted) | Change detection |

---

## Change Detection Security

### The Problem

When detecting "no changes" for commits, we cannot compare blob hashes because:

```
Same Plaintext + Different Nonce → Different Ciphertext → Different Blob Hash
```

This is **by design** for semantic security (IND-CPA), but breaks change detection.

### The Solution

Compare **content hashes** (plaintext) instead of **blob hashes** (ciphertext):

```rust
// Safe: Compare plaintext hashes (never leave client)
let current_content_hash = SHA256(JSON(current_manifest));
let head_content_hash = SHA256(JSON(head_manifest));

if current_content_hash == head_content_hash {
    // No changes
}
```

### Why This Is Safe

#### 1. Content Hash Never Leaves the Client

```
┌─────────────────────────────────────────────────────────────┐
│                        CLIENT                                │
│                                                              │
│   ┌──────────────┐        ┌──────────────┐                  │
│   │   Manifest   │───────▶│ Content Hash │ (stays local)    │
│   │  (Plaintext) │        │   SHA-256    │                  │
│   └──────────────┘        └──────────────┘                  │
│          │                                                   │
│          ▼                                                   │
│   ┌──────────────┐        ┌──────────────┐                  │
│   │   Encrypt    │───────▶│  Blob Hash   │───────────────────┼──▶ Server
│   │  XChaCha20   │        │   SHA-256    │                  │
│   └──────────────┘        └──────────────┘                  │
└─────────────────────────────────────────────────────────────┘
```

#### 2. No Information Leakage

Content hashes are computed and compared entirely client-side:
- Server only sees encrypted blobs and their hashes
- Per-file hashes are persisted only inside the encrypted manifest
- Plaintext hashes are never transmitted as API metadata

#### 3. Deterministic Hashing is Safe for Local Use

Deterministic encryption is **dangerous** when ciphertext is observable (enables frequency analysis). However, our content hash:
- Is not encryption (it's a one-way hash)
- Never leaves the client in plaintext
- Cannot be reversed to obtain plaintext

#### 4. Collision Resistance Maintained

SHA-256's collision resistance ensures:
- Different manifests → different content hashes (with overwhelming probability)
- Change detection is accurate

---

## Threat Model

### Trusted Components

| Component | Trust Level | Justification |
|-----------|-------------|---------------|
| Client machine | Fully trusted | Has plaintext access |
| User passphrase | Secret | Only user knows it |
| Local `.envoy/` directory | Protected | Contains session keys |

### Untrusted Components

| Component | Trust Level | What They See |
|-----------|-------------|---------------|
| Server | Zero trust | Only encrypted blobs |
| Network | Zero trust | Only encrypted traffic |
| Other users | Zero trust | Need passphrase for access |

### Attack Scenarios

#### Scenario 1: Server Compromise

**Threat**: Attacker gains full server access

**Mitigation**: 
- Server only stores encrypted blobs
- No keys or plaintext on server
- Blob hashes reveal nothing about content (non-deterministic)

**Result**: ✅ **Safe** - Attacker gets only ciphertext

#### Scenario 2: Network Eavesdropping

**Threat**: Attacker intercepts network traffic

**Mitigation**:
- All data encrypted with XChaCha20-Poly1305 before transmission
- HTTPS provides transport security (defense in depth)

**Result**: ✅ **Safe** - Double encryption layer

#### Scenario 3: Content Hash Observation

**Threat**: Attacker observes content hashes

**Mitigation**:
- Content hashes never leave client
- Not stored persistently
- Computed only for local comparison

**Result**: ✅ **Safe** - No exposure path

#### Scenario 4: Blob Hash Analysis

**Threat**: Attacker analyzes blob hashes for patterns

**Mitigation**:
- Blob hashes are non-deterministic (random nonce)
- Same content produces different blob hashes
- No frequency analysis possible

**Result**: ✅ **Safe** - IND-CPA security maintained

---

## Managed File Encryption and Access

Manifest v2 uses a single project passphrase. Each file receives an independent
HKDF-derived key and can carry an optional member allowlist. Manifest v1 and
`envy encrypt` retain the legacy per-file passphrase format for compatibility.

### Use Case: Selective Secret Sharing

Consider a project with multiple environment files:
- `.env.development` - Development secrets (can be shared broadly)
- `.env.staging` - Staging secrets (limited team access)
- `.env.production` - Production secrets (restricted access)

With managed files, the owner can:
1. Leave `.env.development` unrestricted to project members
2. Grant `.env.staging` to selected member IDs
3. Keep `.env.production` owner-only with an empty allowlist

### Security Properties

| Property | Status | Notes |
|----------|--------|-------|
| Independent file keys | ✅ | HKDF salt and context derive a unique key |
| One passphrase | ✅ | Managed pull uses only the project passphrase |
| Selective downloads | ✅ | Server checks owner-managed blob grants |
| No key escrow | ✅ | Server never knows the project or file keys |
| Legacy reads | ✅ | Manifest v1 and file-passphrase blobs remain readable |

### Trade-offs

File grants control future server downloads; they are not cryptographic
revocation. A member who already has the project passphrase and downloaded
ciphertext can retain it after access is revoked. Until a rotation command is
implemented, create a new project/passphrase and re-encrypt files when recovery
from a previously trusted member is required.

---

## Security Properties

### Confidentiality

| Property | Status | Mechanism |
|----------|--------|-----------|
| Data at rest (server) | ✅ Encrypted | XChaCha20-Poly1305 |
| Data in transit | ✅ Encrypted | XChaCha20 + HTTPS |
| Key derivation | ✅ Secure | Argon2id |

### Integrity

| Property | Status | Mechanism |
|----------|--------|-----------|
| Data tampering detection | ✅ Protected | Poly1305 MAC |
| Commit chain integrity | ✅ Protected | Parent hash linking |
| Manifest integrity | ✅ Protected | AEAD |

### Semantic Security (IND-CPA)

| Property | Status | Mechanism |
|----------|--------|-----------|
| Ciphertext indistinguishability | ✅ Achieved | Random nonce per encryption |
| No frequency analysis | ✅ Protected | Non-deterministic blob hashes |

### Forward Secrecy

| Property | Status | Notes |
|----------|--------|-------|
| Per-session keys | ⚠️ Partial | Same manifest key across sessions |
| Passphrase change | ❌ Not implemented | Requires a future full re-encryption command |

---

## Potential Weaknesses

### 1. Manifest Structure Leakage (Low Risk)

**Issue**: File count and approximate sizes visible through blob sizes

**Impact**: Low - only metadata, not content

**Mitigation**: Optional padding could be added

### 2. Session Key Persistence (Medium Risk)

**Issue**: Project keys are cached for 15 minutes in `$HOME/.envoy/sessions.json`

**Impact**: Local attacker with file access could extract key

**Mitigation**: 
- Session entries are encrypted with a random local session key
- Consider OS keychain integration for production

### 3. No Key Rotation Mechanism (Low Risk)

**Issue**: Same manifest key used indefinitely

**Impact**: Long-term key exposure and incomplete member revocation

**Mitigation**: Implement passphrase change command

### 4. Timestamp Metadata (Low Risk)

**Issue**: Commit timestamps stored in plaintext (in encrypted commit)

**Impact**: Timing analysis possible if commits decrypted

**Mitigation**: Already encrypted in commit blob

---

## Recommendations

### Current Implementation: ✅ Secure

The current implementation is cryptographically sound for its threat model:

1. **Zero-knowledge server**: ✅ Server never sees plaintext or keys
2. **Semantic security**: ✅ Random nonces prevent pattern analysis
3. **Integrity protection**: ✅ AEAD prevents tampering
4. **Key derivation**: ✅ Argon2id is state-of-the-art

### Future Improvements

| Priority | Improvement | Benefit |
|----------|-------------|---------|
| Medium | OS keychain integration | Better session key protection |
| Low | Blob padding | Hide exact file sizes |
| Low | Key rotation command | Reduce long-term exposure |
| Low | Hardware key support | HSM/YubiKey integration |

---

## Conclusion

The change detection implementation using content hashes is **cryptographically safe** because:

1. **Content hashes never leave the client** - No exposure to untrusted parties
2. **Blob hashes remain non-deterministic** - IND-CPA security preserved for server-stored data
3. **SHA-256 is collision-resistant** - Accurate change detection guaranteed
4. **Separation of concerns** - Storage addressing (blob hash) vs. change detection (content hash) are properly isolated

The implementation maintains the zero-trust model while enabling practical features like "nothing to commit" detection.

---

*Document Version: 1.1*  
*Last Updated: April 4, 2026*  
*Applies to: Envoy v0.2.4+*
