"""Stream one member of a remote zip to stdout without storing the archive.

The relay container's filesystem is read-only with a small tmpfs, and the FAA
registry zip is tens of megabytes. zipfile needs a seekable file, so one is
built on HTTP range requests; only the central directory and the requested
member are ever transferred.
"""

import io
import sys
import time
import urllib.error
import urllib.request
import zipfile

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)
CHUNK = 2 * 1024 * 1024
ATTEMPTS = 5


class RangeFile(io.RawIOBase):
    def __init__(self, url: str) -> None:
        self.url = url
        self.position = 0
        self.size = self._probe()

    def _request(self, start: int, end: int) -> tuple[bytes, str]:
        request = urllib.request.Request(
            self.url,
            headers={"User-Agent": USER_AGENT, "Range": f"bytes={start}-{end}"},
        )
        last_error: Exception | None = None
        for attempt in range(ATTEMPTS):
            try:
                with urllib.request.urlopen(request, timeout=60) as response:
                    return response.read(), response.headers.get("Content-Range", "")
            except (urllib.error.URLError, TimeoutError, ConnectionError) as error:
                last_error = error
                time.sleep(2 * (attempt + 1))
        raise RuntimeError(f"range {start}-{end} failed: {last_error}")

    def _probe(self) -> int:
        _, content_range = self._request(0, 0)
        if "/" not in content_range:
            raise RuntimeError("server does not support range requests")
        return int(content_range.rsplit("/", 1)[1])

    def readable(self) -> bool:
        return True

    def seekable(self) -> bool:
        return True

    def tell(self) -> int:
        return self.position

    def seek(self, offset: int, whence: int = io.SEEK_SET) -> int:
        if whence == io.SEEK_SET:
            self.position = offset
        elif whence == io.SEEK_CUR:
            self.position += offset
        else:
            self.position = self.size + offset
        self.position = max(0, min(self.position, self.size))
        return self.position

    def readinto(self, buffer) -> int:
        wanted = min(len(buffer), self.size - self.position)
        if wanted <= 0:
            return 0
        data, _ = self._request(self.position, self.position + wanted - 1)
        buffer[: len(data)] = data
        self.position += len(data)
        return len(data)


def main() -> int:
    url, member = sys.argv[1], sys.argv[2]
    source = io.BufferedReader(RangeFile(url), buffer_size=CHUNK)
    with zipfile.ZipFile(source) as archive, archive.open(member) as stream:
        out = sys.stdout.buffer
        while True:
            block = stream.read(1024 * 1024)
            if not block:
                break
            out.write(block)
    return 0


if __name__ == "__main__":
    sys.exit(main())
