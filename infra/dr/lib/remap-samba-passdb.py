#!/usr/bin/env python3
"""Map Samba import Unix IDs to restored local accounts; preserve credentials."""
import pwd
import re
import sys


def remap(lines, lookup=pwd.getpwnam):
    for line in lines:
        fields = line.rstrip('\n').split(':')
        if len(fields) != 7 or not re.fullmatch(r'(?:deniz-api-broker|dc-[a-z0-9-]+-[0-9a-f]{8})', fields[0]):
            raise ValueError('unexpected Samba password export record')
        if not fields[1].isdigit() or any(not re.fullmatch(r'[A-Fa-f0-9X]{32}', fields[i]) for i in (2, 3)):
            raise ValueError('invalid Samba password export fields')
        fields[1] = str(lookup(fields[0]).pw_uid)
        yield ':'.join(fields)


if __name__ == '__main__':
    try:
        with open(sys.argv[1]) as source:
            rows = list(remap(source))
        for row in rows:
            print(row)
    except (OSError, KeyError, ValueError) as error:
        sys.exit('STOP: cannot map Samba import to local Unix accounts: ' + str(error))
