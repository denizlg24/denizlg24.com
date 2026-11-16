#!/usr/bin/env python3
"""Pack disposable namespace staging, reclaiming each copied extent on Linux.

The unpublished source is consumed. A failed pack must be discarded and recaptured;
no READY manifest may reference it. This bounds temporary space to one archive.
"""
import ctypes
import os
from pathlib import Path
import sys
import tarfile

CHUNK = 8 * 1024 * 1024


class ConsumingReader:
    def __init__(self, source, output, punch):
        self.source, self.output, self.punch = source, output, punch
        self.pending = None

    def release(self):
        if self.pending is None:
            return
        self.output.flush()
        offset, length = self.pending
        if self.punch(self.source.fileno(), 3, offset, length) != 0:
            error = ctypes.get_errno()
            raise OSError(error, os.strerror(error))
        self.pending = None

    def read(self, length):
        self.release()
        offset = self.source.tell()
        value = self.source.read(length)
        if value:
            self.pending = (offset, len(value))
        return value


def pack(source: Path, destination: Path):
    source = source.resolve(strict=True)
    destination = destination.resolve()
    if source == destination or source in destination.parents:
        raise ValueError("output must be outside disposable namespace staging")
    if destination.exists():
        raise ValueError("output already exists")
    punch = ctypes.CDLL(None, use_errno=True).fallocate
    punch.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_longlong, ctypes.c_longlong]
    punch.restype = ctypes.c_int
    # Match tar's `-C staging .` paths; the nested archives retain the full
    # namespace metadata. Only these outer, disposable staging files are consumed.
    paths = [source] + sorted(source.rglob("*"))
    if any(path.is_symlink() or not (path.is_file() or path.is_dir()) for path in paths):
        raise ValueError("namespace staging must contain regular files and directories")
    try:
        with destination.open("xb", buffering=CHUNK) as output:
            os.chmod(destination, 0o600)
            with tarfile.open(fileobj=output, mode="w", format=tarfile.PAX_FORMAT,
                              copybufsize=CHUNK) as archive:
                for path in paths:
                    name = "." if path == source else "./" + str(path.relative_to(source))
                    info = archive.gettarinfo(str(path), arcname=name)
                    if path.is_dir():
                        archive.addfile(info)
                        continue
                    with path.open("r+b", buffering=0) as incoming:
                        reader = ConsumingReader(incoming, output, punch)
                        archive.addfile(info, reader)
                        reader.release()
                    path.unlink()
            output.flush()
            os.fsync(output.fileno())
    except BaseException:
        destination.unlink(missing_ok=True)
        raise


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: pack-namespace.py DISPOSABLE_STAGING OUTPUT")
    pack(Path(sys.argv[1]), Path(sys.argv[2]))
