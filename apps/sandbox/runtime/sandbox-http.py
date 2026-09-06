#!/usr/bin/env python3
import json
import sys
import urllib.error
import urllib.request

url = sys.argv[1]
try:
    response = urllib.request.urlopen(url, timeout=25)
except urllib.error.HTTPError as error:
    response = error

print(
    json.dumps(
        {
            "status": response.status,
            "contentType": response.headers.get("content-type"),
        }
    ),
    flush=True,
)
while chunk := response.read(64 * 1024):
    sys.stdout.buffer.write(chunk)
