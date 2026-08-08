/**
 * POSIX Gate 1 validates filesystem behaviour the Pi depends on — symlink
 * refusal, sparse files, atomic replacement, mergerfs mounts — by driving shell
 * scripts against disposable roots. None of that is expressible on Windows:
 * `symlink(2)` needs SeCreateSymbolicLinkPrivilege, `/bin/bash` does not exist,
 * and the harness builds POSIX paths that resolve to nonsense like `/E:/...`.
 * The scripts under test only ever run on Linux, and CI runs these there.
 *
 * Gating on the platform rather than probing each capability keeps the reason
 * legible: this whole family is Linux tooling, not a set of tests that happen
 * to need one privilege.
 */
export const POSIX_GATE1_SUPPORTED = process.platform !== "win32";
